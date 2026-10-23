package com.vp

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class VendorUpdateModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val isDownloading = AtomicBoolean(false)

    override fun getName(): String = "VendorUpdateModule"

    private fun sendEvent(eventName: String, params: Any?) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for React Native event emitter
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        // Required for React Native event emitter
    }

    @ReactMethod
    fun getAppInfo(promise: Promise) {
        try {
            val pm = reactContext.packageManager
            val pkgName = reactContext.packageName
            val pInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getPackageInfo(pkgName, PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                pm.getPackageInfo(pkgName, 0)
            }

            val versionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }

            val map = Arguments.createMap().apply {
                putDouble("versionCode", versionCode.toDouble())
                putString("versionName", pInfo.versionName ?: "")
                putString("packageName", pkgName)
            }
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("E_APP_INFO", "Failed to retrieve package information: ${e.message}", e)
        }
    }

    @ReactMethod
    fun canRequestPackageInstalls(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val canInstall = reactContext.packageManager.canRequestPackageInstalls()
                promise.resolve(canInstall)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("E_PERMISSION_CHECK", "Failed to check install permissions: ${e.message}", e)
        }
    }

    @ReactMethod
    fun openInstallPermissionSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("E_SETTINGS_LAUNCH", "Failed to open install permission settings: ${e.message}", e)
        }
    }

    private fun isHostAllowed(host: String?): Boolean {
        if (host == null) return false
        val lowerHost = host.lowercase()
        return lowerHost == "github.com" ||
                lowerHost.endsWith(".github.com") ||
                lowerHost == "objects.githubusercontent.com" ||
                lowerHost.endsWith(".githubusercontent.com") ||
                lowerHost.endsWith(".amazonaws.com")
    }

    private fun calculateFileSha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        file.inputStream().use { input ->
            var read: Int
            while (input.read(buffer).also { read = it } != -1) {
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    @ReactMethod
    fun isApkAlreadyDownloaded(expectedSha256: String, promise: Promise) {
        try {
            val apkFile = File(File(reactContext.cacheDir, "updates"), "vendor-update.apk")
            if (apkFile.exists() && apkFile.length() > 0 && expectedSha256.isNotBlank()) {
                val existingHash = calculateFileSha256(apkFile)
                promise.resolve(existingHash.equals(expectedSha256.trim(), ignoreCase = true))
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun downloadAndVerifyApk(urlStr: String, expectedSha256: String, promise: Promise) {
        if (!isDownloading.compareAndSet(false, true)) {
            promise.reject("E_CONCURRENT_DOWNLOAD", "An update download is already in progress")
            return
        }

        Thread {
            try {
                // 1. Validate initial URL
                val initialUrl = URL(urlStr)
                if (initialUrl.protocol != "https") {
                    throw IllegalArgumentException("Insecure download protocol: HTTPS is strictly required")
                }

                val initialHost = initialUrl.host.lowercase()
                if (initialHost != "github.com" && !initialHost.endsWith(".github.com")) {
                    throw IllegalArgumentException("Disallowed download host: $initialHost")
                }

                if (!initialUrl.path.startsWith("/chethanvishvin/vendor/releases/")) {
                    throw IllegalArgumentException("Invalid repository release download path: ${initialUrl.path}")
                }

                if (expectedSha256.isBlank() || expectedSha256.length != 64) {
                    throw IllegalArgumentException("Invalid SHA-256 checksum in version manifest")
                }

                // 2. Prepare destination files & check if valid APK is already downloaded
                val updatesDir = File(reactContext.cacheDir, "updates")
                if (!updatesDir.exists()) {
                    updatesDir.mkdirs()
                }
                val apkFile = File(updatesDir, "vendor-update.apk")

                if (apkFile.exists() && apkFile.length() > 0) {
                    val existingHash = calculateFileSha256(apkFile)
                    if (existingHash.equals(expectedSha256.trim(), ignoreCase = true)) {
                        val progressMap = Arguments.createMap().apply {
                            putDouble("receivedBytes", apkFile.length().toDouble())
                            putDouble("totalBytes", apkFile.length().toDouble())
                            putInt("percent", 100)
                        }
                        sendEvent("onDownloadProgress", progressMap)
                        promise.resolve(apkFile.absolutePath)
                        return@Thread
                    } else {
                        apkFile.delete()
                    }
                }

                val tempFile = File(updatesDir, "vendor-update.apk.tmp")
                if (tempFile.exists()) {
                    tempFile.delete()
                }

                // 3. Build HTTP client with security interceptor & timeouts
                val redirectValidator = Interceptor { chain ->
                    val request = chain.request()
                    val targetUrl = request.url
                    if (targetUrl.scheme != "https") {
                        throw IOException("Non-HTTPS redirect blocked: ${targetUrl.scheme}")
                    }
                    if (!isHostAllowed(targetUrl.host)) {
                        throw IOException("Redirect to untrusted host blocked: ${targetUrl.host}")
                    }
                    chain.proceed(request)
                }

                val client = OkHttpClient.Builder()
                    .addNetworkInterceptor(redirectValidator)
                    .connectTimeout(30, TimeUnit.SECONDS)
                    .readTimeout(60, TimeUnit.SECONDS)
                    .followRedirects(true)
                    .followSslRedirects(true)
                    .build()

                val request = Request.Builder()
                    .url(urlStr)
                    .header("User-Agent", "Vendor-Android-App")
                    .build()

                val response: Response = client.newCall(request).execute()
                if (!response.isSuccessful) {
                    throw IOException("HTTP request failed with status: ${response.code}")
                }

                val body = response.body ?: throw IOException("Empty HTTP response body")
                val contentLength = body.contentLength()
                val digest = MessageDigest.getInstance("SHA-256")

                val buffer = ByteArray(8192)
                var totalRead = 0L
                var lastPercent = -1

                body.byteStream().use { input ->
                    FileOutputStream(tempFile).use { output ->
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            digest.update(buffer, 0, read)
                            totalRead += read

                            if (contentLength > 0) {
                                val percent = ((totalRead * 100) / contentLength).toInt()
                                if (percent != lastPercent) {
                                    lastPercent = percent
                                    val progressMap = Arguments.createMap().apply {
                                        putDouble("receivedBytes", totalRead.toDouble())
                                        putDouble("totalBytes", contentLength.toDouble())
                                        putInt("percent", percent)
                                    }
                                    sendEvent("onDownloadProgress", progressMap)
                                }
                            }
                        }
                        output.flush()
                    }
                }

                if (totalRead <= 0) {
                    tempFile.delete()
                    throw IOException("Downloaded APK is 0 bytes")
                }

                // 4. Verify SHA-256
                val computedHash = digest.digest().joinToString("") { "%02x".format(it) }
                if (!computedHash.equals(expectedSha256.trim(), ignoreCase = true)) {
                    tempFile.delete()
                    throw SecurityException(
                        "SHA-256 verification failed. Expected: $expectedSha256, Computed: $computedHash"
                    )
                }

                // 5. Atomic file replacement
                if (apkFile.exists()) {
                    apkFile.delete()
                }
                if (!tempFile.renameTo(apkFile)) {
                    tempFile.copyTo(apkFile, overwrite = true)
                    tempFile.delete()
                }

                promise.resolve(apkFile.absolutePath)
            } catch (e: Exception) {
                // Ensure temp file cleaned up on error
                val tempFile = File(File(reactContext.cacheDir, "updates"), "vendor-update.apk.tmp")
                if (tempFile.exists()) {
                    tempFile.delete()
                }
                promise.reject("E_DOWNLOAD_FAILED", e.message ?: "Failed to download update APK", e)
            } finally {
                isDownloading.set(false)
            }
        }.start()
    }

    @ReactMethod
    fun installApk(promise: Promise) {
        try {
            val apkFile = File(File(reactContext.cacheDir, "updates"), "vendor-update.apk")
            if (!apkFile.exists() || apkFile.length() <= 0) {
                promise.reject("E_NO_APK", "No downloaded APK found to install")
                return
            }

            // Check install unknown apps permission
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val canInstall = reactContext.packageManager.canRequestPackageInstalls()
                if (!canInstall) {
                    promise.reject(
                        "E_PERMISSION_REQUIRED",
                        "Permission to install unknown apps from this source is required"
                    )
                    return
                }
            }

            val apkUri: Uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            reactContext.startActivity(installIntent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_INSTALL_FAILED", "Could not trigger package installer: ${e.message}", e)
        }
    }

    @ReactMethod
    fun deleteUpdateApk(promise: Promise) {
        try {
            val updatesDir = File(reactContext.cacheDir, "updates")
            if (updatesDir.exists()) {
                updatesDir.deleteRecursively()
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("E_DELETE_FAILED", "Failed to clean update directory: ${e.message}", e)
        }
    }
}
