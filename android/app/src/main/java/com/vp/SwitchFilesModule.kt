package com.vp

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream

class SwitchFilesModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SwitchFilesModule"

    companion object {
        val SWITCH_FILES = listOf(
            "switchfirmware.imag",
            "switchconfig.cfg"
        )
    }

    private fun openAssetStream(fileName: String): InputStream {
        val assetManager = reactContext.assets
        // 1. Try switch_files/<fileName>
        return try {
            assetManager.open("switch_files/$fileName")
        } catch (e1: Exception) {
            // 2. Try root assets/<fileName>
            try {
                assetManager.open(fileName)
            } catch (e2: Exception) {
                throw IllegalStateException("File '$fileName' was not found in android/app/src/main/assets/ or assets/switch_files/")
            }
        }
    }

    private fun getMimeType(fileName: String): String {
        return "application/octet-stream"
    }

    private fun copyAssetToTempCache(fileName: String): File {
        val docsDir = File(reactContext.cacheDir, "documents")
        if (!docsDir.exists()) {
            docsDir.mkdirs()
        }
        val destFile = File(docsDir, fileName)
        openAssetStream(fileName).use { input ->
            FileOutputStream(destFile).use { output ->
                input.copyTo(output)
            }
        }
        return destFile
    }

    @ReactMethod
    fun getSwitchFilesInfo(promise: Promise) {
        try {
            val list: WritableArray = Arguments.createArray()
            for (fName in SWITCH_FILES) {
                var sizeBytes = 0L
                var exists = false
                try {
                    openAssetStream(fName).use { stream ->
                        sizeBytes = stream.available().toLong()
                        exists = true
                    }
                } catch (ignored: Exception) {}

                val item: WritableMap = Arguments.createMap()
                item.putString("fileName", fName)
                item.putBoolean("exists", exists)
                item.putDouble("sizeBytes", sizeBytes.toDouble())
                list.pushMap(item)
            }
            promise.resolve(list)
        } catch (e: Exception) {
            promise.reject("ERR_FILES_INFO", e.message, e)
        }
    }

    @ReactMethod
    fun downloadSwitchFile(fileName: String, promise: Promise) {
        try {
            val cleanName = File(fileName).name
            val mimeType = getMimeType(cleanName)
            var finalPath = ""

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, cleanName)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val resolver = reactContext.contentResolver
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    ?: throw IllegalStateException("Failed to create download entry in MediaStore")

                resolver.openOutputStream(uri)?.use { outStream ->
                    openAssetStream(cleanName).use { inStream ->
                        inStream.copyTo(outStream)
                    }
                }
                finalPath = "Downloads/$cleanName"
            } else {
                @Suppress("DEPRECATION")
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs()
                }
                val destFile = File(downloadsDir, cleanName)
                openAssetStream(cleanName).use { inStream ->
                    FileOutputStream(destFile).use { outStream ->
                        inStream.copyTo(outStream)
                    }
                }
                finalPath = destFile.absolutePath
                MediaScannerConnection.scanFile(
                    reactContext,
                    arrayOf(destFile.absolutePath),
                    arrayOf(mimeType),
                    null
                )
            }

            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putString("filePath", finalPath)
                putString("fileName", cleanName)
                putString("message", "$cleanName saved to Downloads folder")
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR_DOWNLOAD", e.message, e)
        }
    }

    @ReactMethod
    fun downloadAllSwitchFiles(promise: Promise) {
        try {
            val downloadedPaths: WritableArray = Arguments.createArray()
            for (fName in SWITCH_FILES) {
                val mimeType = getMimeType(fName)
                var path = ""

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val contentValues = ContentValues().apply {
                        put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, fName)
                        put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mimeType)
                        put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val resolver = reactContext.contentResolver
                    val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    if (uri != null) {
                        resolver.openOutputStream(uri)?.use { outStream ->
                            openAssetStream(fName).use { inStream ->
                                inStream.copyTo(outStream)
                            }
                        }
                        path = "Downloads/$fName"
                    }
                } else {
                    @Suppress("DEPRECATION")
                    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!downloadsDir.exists()) downloadsDir.mkdirs()
                    val destFile = File(downloadsDir, fName)
                    openAssetStream(fName).use { inStream ->
                        FileOutputStream(destFile).use { outStream ->
                            inStream.copyTo(outStream)
                        }
                    }
                    path = destFile.absolutePath
                    MediaScannerConnection.scanFile(reactContext, arrayOf(destFile.absolutePath), arrayOf(mimeType), null)
                }
                downloadedPaths.pushString(path)
            }

            val result = Arguments.createMap().apply {
                putBoolean("success", true)
                putArray("filePaths", downloadedPaths)
                putString("message", "Both switch files saved to Downloads folder")
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("ERR_DOWNLOAD_ALL", e.message, e)
        }
    }

    @ReactMethod
    fun shareSwitchFile(fileName: String, promise: Promise) {
        try {
            val cleanName = File(fileName).name
            val file = copyAssetToTempCache(cleanName)
            val uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                file
            )
            val mimeType = getMimeType(cleanName)

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, cleanName)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            val chooser = Intent.createChooser(shareIntent, "Share $cleanName").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SHARE", e.message, e)
        }
    }

    @ReactMethod
    fun shareAllSwitchFiles(promise: Promise) {
        try {
            val uris = ArrayList<Uri>()
            for (fName in SWITCH_FILES) {
                val file = copyAssetToTempCache(fName)
                val uri = FileProvider.getUriForFile(
                    reactContext,
                    "${reactContext.packageName}.fileprovider",
                    file
                )
                uris.add(uri)
            }

            if (uris.isEmpty()) {
                throw IllegalStateException("No switch files available to share")
            }

            val shareIntent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
                type = "*/*"
                putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
                putExtra(Intent.EXTRA_SUBJECT, "KPTCL Switch Firmware and Configuration Files")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            val chooser = Intent.createChooser(shareIntent, "Share Switch Files").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_SHARE_ALL", e.message, e)
        }
    }
}
