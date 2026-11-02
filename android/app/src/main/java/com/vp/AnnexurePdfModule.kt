package com.vp

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class AnnexurePdfModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AnnexurePdfModule"

    companion object {
        const val DEFAULT_DWA_NO = "0228 | B31/SEE(IT)/EE(IT-4)/AEE3/76452/1/2026-2027"
        const val DEFAULT_DWA_DATE = "02 JUL 2026"
    }

    private fun getSanitizedStationName(raw: String?): String {
        val name = raw?.trim() ?: "Substation"
        return name.replace(Regex("[^a-zA-Z0-9_\\-]"), "_")
    }

    private fun getDocumentsDir(): File {
        val dir = File(reactContext.cacheDir, "documents")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    data class StationPdfItem(
        val substationName: String,
        val officeDescription: String?
    )

    private fun extractStationItems(options: ReadableMap): List<StationPdfItem> {
        val list = mutableListOf<StationPdfItem>()
        if (options.hasKey("stations")) {
            val arr = options.getArray("stations")
            if (arr != null) {
                for (i in 0 until arr.size()) {
                    val map = arr.getMap(i)
                    val name = if (map?.hasKey("substationName") == true) map.getString("substationName") ?: "Substation" else "Substation"
                    val desc = if (map?.hasKey("officeDescription") == true) map.getString("officeDescription") else null
                    list.add(StationPdfItem(name, desc))
                }
            }
        }
        if (list.isEmpty()) {
            val name = options.getString("substationName") ?: "Substation"
            val desc = if (options.hasKey("officeDescription")) options.getString("officeDescription") else null
            list.add(StationPdfItem(name, desc))
        }
        return list
    }

    private fun renderStationPage(
        canvas: Canvas,
        pageWidth: Int,
        pageHeight: Int,
        marginHorizontal: Float,
        marginVertical: Float,
        printableWidth: Int,
        substationName: String,
        officeDescription: String?,
        dwaNo: String,
        dateStr: String
    ) {
        // Fill background white
        val bgPaint = Paint().apply { color = Color.WHITE }
        canvas.drawRect(0f, 0f, pageWidth.toFloat(), pageHeight.toFloat(), bgPaint)

        // Typefaces
        val serifBold = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        val serifNormal = Typeface.create(Typeface.SERIF, Typeface.NORMAL)

        var currentY = marginVertical

        fun drawTextBlock(
            text: CharSequence,
            paint: TextPaint,
            width: Int,
            alignment: Layout.Alignment = Layout.Alignment.ALIGN_NORMAL,
            startX: Float = marginHorizontal,
            extraSpacing: Float = 6f
        ) {
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                StaticLayout.Builder.obtain(text, 0, text.length, paint, width)
                    .setAlignment(alignment)
                    .setLineSpacing(2f, 1.15f)
                    .setIncludePad(false)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                StaticLayout(
                    text,
                    paint,
                    width,
                    alignment,
                    1.15f,
                    2f,
                    false
                )
            }
            canvas.save()
            canvas.translate(startX, currentY)
            builder.draw(canvas)
            canvas.restore()
            currentY += builder.height + extraSpacing
        }

        // 1. Header: Annexure - 11
        val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifBold
            textSize = 14.5f
            color = Color.BLACK
        }
        drawTextBlock("Annexure - 11", titlePaint, printableWidth, Layout.Alignment.ALIGN_CENTER, extraSpacing = 4f)

        // 2. Subtitle: Work Completion Certificate for Part-1 Portion
        val subtitlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifBold
            textSize = 12.5f
            color = Color.BLACK
        }
        drawTextBlock(
            "Work Completion Certificate for Part-1 Portion",
            subtitlePaint,
            printableWidth,
            Layout.Alignment.ALIGN_CENTER,
            extraSpacing = 4f
        )

        // 3. Description Header
        val descPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifBold
            textSize = 10f
            color = Color.BLACK
        }
        drawTextBlock(
            "Part-1: Implementation of Resilient Network Architecture across KPTCL Substations and the establishment of a Central Command Control Center at corporate office.",
            descPaint,
            printableWidth,
            Layout.Alignment.ALIGN_CENTER,
            extraSpacing = 22f
        )

        // 4. Addressee: To ... (flush left)
        val toPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifBold
            textSize = 10.5f
            color = Color.BLACK
        }
        val toText = "To\nThe Superintending Engineer (IT),\nCorporate Office, KPTCL,\nIndhana Bhavan, Racecourse Road,\nBengaluru-09."
        drawTextBlock(toText, toPaint, printableWidth, Layout.Alignment.ALIGN_NORMAL, startX = marginHorizontal, extraSpacing = 18f)

        // 5. Subject with Station Address & Name in Bracket (flush left, matching PDF)
        val subjectPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifBold
            textSize = 10.5f
            color = Color.BLACK
        }
        val officeText = if (!officeDescription.isNullOrBlank()) officeDescription.trim() else substationName.trim()
        val subLine = "Sub: Work Completion Certificate for the office of $officeText"
        drawTextBlock(subLine, subjectPaint, printableWidth, Layout.Alignment.ALIGN_NORMAL, startX = marginHorizontal, extraSpacing = 5f)

        // 6. Reference Lines (Ref:DWA No: ... and Dated: ... on two separate lines, matching PDF)
        val refDwa = if (dwaNo.isNotBlank()) dwaNo.trim() else DEFAULT_DWA_NO
        val refDate = if (dateStr.isNotBlank()) dateStr.trim() else DEFAULT_DWA_DATE
        val refLine = "Ref:DWA No: $refDwa\nDated: $refDate"
        drawTextBlock(refLine, subjectPaint, printableWidth, Layout.Alignment.ALIGN_NORMAL, startX = marginHorizontal, extraSpacing = 18f)

        // 7. Body Lead-in
        val bodyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifNormal
            textSize = 10.5f
            color = Color.BLACK
        }
        val bodyIntro = "The firm have supplied the Bill of materials as required for Implementation of Resilient Network Architecture for KPTCL Substations"
        drawTextBlock(bodyIntro, bodyPaint, printableWidth, Layout.Alignment.ALIGN_NORMAL, startX = marginHorizontal, extraSpacing = 16f)

        // 8. Items a & b (indented list)
        val itemIndent = marginHorizontal + 22f
        val itemWidth = printableWidth - 22
        val itemA = "a. The firm have successfully Implemented Resilient Network Architecture with Secured Structured Cabling and LAN Networking along with necessary cables & other consumables as per Part -1 portion of Sub Total - C of Price Schedule clause 4"
        drawTextBlock(itemA, bodyPaint, itemWidth, Layout.Alignment.ALIGN_NORMAL, startX = itemIndent, extraSpacing = 12f)

        val itemB = "b. The firm have successfully installed, Tested and commissioned as per Part-1 portion of Sub Total - D of Price schedule clause 4"
        drawTextBlock(itemB, bodyPaint, itemWidth, Layout.Alignment.ALIGN_NORMAL, startX = itemIndent, extraSpacing = 56f)

        // 9. Signature Block - bottom left, ONLY Signature and Substation In charge / JE / AE
        val signPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            typeface = serifBold
            textSize = 10.5f
            color = Color.BLACK
        }
        val signText = "Signature\nSubstation In charge / JE / AE"
        drawTextBlock(signText, signPaint, printableWidth, Layout.Alignment.ALIGN_NORMAL, startX = marginHorizontal, extraSpacing = 0f)
    }

    private fun createPdfDocumentFile(
        items: List<StationPdfItem>,
        dwaNo: String,
        dateStr: String
    ): File {
        val pageWidth = 595
        val pageHeight = 842
        val marginHorizontal = 54f
        val marginVertical = 54f
        val printableWidth = (pageWidth - (marginHorizontal * 2)).toInt()

        val document = PdfDocument()

        for ((index, item) in items.withIndex()) {
            val pageInfo = PdfDocument.PageInfo.Builder(pageWidth, pageHeight, index + 1).create()
            val page = document.startPage(pageInfo)
            renderStationPage(
                page.canvas,
                pageWidth,
                pageHeight,
                marginHorizontal,
                marginVertical,
                printableWidth,
                item.substationName,
                item.officeDescription,
                dwaNo,
                dateStr
            )
            document.finishPage(page)
        }

        val baseFileName = if (items.size > 1) {
            "Annexure-11_All_Pending_${items.size}Stations"
        } else {
            val safeName = getSanitizedStationName(items.firstOrNull()?.substationName)
            "Annexure-11_${safeName}"
        }

        val file = File(getDocumentsDir(), "${baseFileName}.pdf")
        FileOutputStream(file).use { out ->
            document.writeTo(out)
        }
        document.close()
        return file
    }

    private fun generateHtml(
        items: List<StationPdfItem>,
        dwaNo: String,
        dateStr: String
    ): String {
        val refDwa = if (dwaNo.isNotBlank()) dwaNo.trim() else DEFAULT_DWA_NO
        val refDate = if (dateStr.isNotBlank()) dateStr.trim() else DEFAULT_DWA_DATE

        val pagesHtml = items.map { item ->
            val officeText = if (!item.officeDescription.isNullOrBlank()) item.officeDescription.trim() else item.substationName.trim()
            """
            <div class="page">
              <div class="text-center font-bold title">Annexure - 11</div>
              <div class="text-center font-bold subtitle">Work Completion Certificate for Part-1 Portion</div>
              <div class="text-center font-bold desc">
                Part-1: Implementation of Resilient Network Architecture across KPTCL Substations and the establishment of a Central Command Control Center at corporate office.
              </div>

              <div class="address">
                To<br/>
                The Superintending Engineer (IT),<br/>
                Corporate Office, KPTCL,<br/>
                Indhana Bhavan, Racecourse Road,<br/>
                Bengaluru-09.
              </div>

              <div class="subject-block">
                Sub: Work Completion Certificate for the office of $officeText<br/>
                Ref:DWA No: $refDwa<br/>
                Dated: $refDate
              </div>

              <div class="body-intro">
                The firm have supplied the Bill of materials as required for Implementation of Resilient Network Architecture for KPTCL Substations
              </div>

              <div class="item-row">
                a. The firm have successfully Implemented Resilient Network Architecture with Secured Structured Cabling and LAN Networking along with necessary cables &amp; other consumables as per Part -1 portion of Sub Total - C of Price Schedule clause 4
              </div>

              <div class="item-row">
                b. The firm have successfully installed, Tested and commissioned as per Part-1 portion of Sub Total - D of Price schedule clause 4
              </div>

              <div class="signature-block">
                Signature<br/>
                Substation In charge / JE / AE
              </div>
            </div>
            """.trimIndent()
        }.joinToString("\n")

        return """
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8" />
              <title>Annexure - 11</title>
              <style>
                @page {
                  size: A4 portrait;
                  margin: 18mm;
                }
                body {
                  font-family: 'Times New Roman', Times, serif;
                  color: #000;
                  background-color: #fff;
                  margin: 0;
                  padding: 0;
                  line-height: 1.4;
                  font-size: 15px;
                }
                .page {
                  padding: 24px;
                  page-break-after: always;
                  break-after: page;
                  box-sizing: border-box;
                }
                .page:last-child {
                  page-break-after: avoid;
                  break-after: avoid;
                }
                .text-center { text-align: center; }
                .font-bold { font-weight: bold; }
                .title { font-size: 20px; margin-bottom: 6px; }
                .subtitle { font-size: 16.5px; margin-bottom: 6px; }
                .desc { font-size: 13px; margin-bottom: 26px; line-height: 1.35; }
                .address { font-weight: bold; margin-bottom: 22px; line-height: 1.45; }
                .subject-block {
                  font-weight: bold;
                  margin-bottom: 22px;
                  line-height: 1.5;
                }
                .body-intro { margin-bottom: 18px; line-height: 1.45; }
                .item-row {
                  margin-left: 24px;
                  margin-bottom: 14px;
                  line-height: 1.45;
                }
                .signature-block {
                  margin-top: 60px;
                  font-weight: bold;
                  line-height: 1.5;
                }
              </style>
            </head>
            <body>
              $pagesHtml
            </body>
            </html>
        """.trimIndent()
    }

    @ReactMethod
    fun generateAnnexurePdf(options: ReadableMap, promise: Promise) {
        try {
            val items = extractStationItems(options)
            val dwa = if (options.hasKey("dwaNo") && !options.getString("dwaNo").isNullOrBlank()) {
                options.getString("dwaNo") ?: DEFAULT_DWA_NO
            } else {
                DEFAULT_DWA_NO
            }
            val dateStr = if (options.hasKey("date") && !options.getString("date").isNullOrBlank()) {
                options.getString("date") ?: DEFAULT_DWA_DATE
            } else {
                DEFAULT_DWA_DATE
            }

            val pdfFile = createPdfDocumentFile(items, dwa, dateStr)
            val uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                pdfFile
            )

            val res = Arguments.createMap().apply {
                putBoolean("success", true)
                putString("filePath", pdfFile.absolutePath)
                putString("fileName", pdfFile.name)
                putString("contentUri", uri.toString())
                putDouble("fileSize", pdfFile.length().toDouble())
                putInt("pageCount", items.size)
            }
            promise.resolve(res)
        } catch (e: Exception) {
            promise.reject("PDF_GEN_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun downloadAnnexurePdf(options: ReadableMap, promise: Promise) {
        try {
            val items = extractStationItems(options)
            val dwa = if (options.hasKey("dwaNo") && !options.getString("dwaNo").isNullOrBlank()) {
                options.getString("dwaNo") ?: DEFAULT_DWA_NO
            } else {
                DEFAULT_DWA_NO
            }
            val dateStr = if (options.hasKey("date") && !options.getString("date").isNullOrBlank()) {
                options.getString("date") ?: DEFAULT_DWA_DATE
            } else {
                DEFAULT_DWA_DATE
            }

            val sourcePdf = createPdfDocumentFile(items, dwa, dateStr)
            val timeStamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(Date())
            val targetFileName = if (items.size > 1) {
                "Annexure-11_All_Pending_${items.size}Stations_${timeStamp}.pdf"
            } else {
                val safeName = getSanitizedStationName(items.firstOrNull()?.substationName)
                "Annexure-11_${safeName}_${timeStamp}.pdf"
            }

            var finalPath = ""

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val contentValues = ContentValues().apply {
                    put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, targetFileName)
                    put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/pdf")
                    put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                }
                val resolver = reactContext.contentResolver
                val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
                    ?: throw IllegalStateException("Failed to create download item in MediaStore")

                resolver.openOutputStream(uri)?.use { outStream ->
                    FileInputStream(sourcePdf).use { inStream ->
                        inStream.copyTo(outStream)
                    }
                }
                finalPath = "Downloads/$targetFileName"
            } else {
                @Suppress("DEPRECATION")
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs()
                }
                val destFile = File(downloadsDir, targetFileName)
                FileInputStream(sourcePdf).use { inStream ->
                    FileOutputStream(destFile).use { outStream ->
                        inStream.copyTo(outStream)
                    }
                }
                finalPath = destFile.absolutePath
                MediaScannerConnection.scanFile(
                    reactContext,
                    arrayOf(destFile.absolutePath),
                    arrayOf("application/pdf"),
                    null
                )
            }

            val successMsg = if (items.size > 1) {
                "Combined Annexure-11 PDF (${items.size} pending stations) saved to Downloads"
            } else {
                "Annexure-11 saved successfully to Downloads"
            }

            val res = Arguments.createMap().apply {
                putBoolean("success", true)
                putString("filePath", finalPath)
                putString("fileName", targetFileName)
                putString("message", successMsg)
                putInt("pageCount", items.size)
            }
            promise.resolve(res)
        } catch (e: Exception) {
            promise.reject("DOWNLOAD_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun shareAnnexurePdf(options: ReadableMap, promise: Promise) {
        try {
            val items = extractStationItems(options)
            val dwa = if (options.hasKey("dwaNo") && !options.getString("dwaNo").isNullOrBlank()) {
                options.getString("dwaNo") ?: DEFAULT_DWA_NO
            } else {
                DEFAULT_DWA_NO
            }
            val dateStr = if (options.hasKey("date") && !options.getString("date").isNullOrBlank()) {
                options.getString("date") ?: DEFAULT_DWA_DATE
            } else {
                DEFAULT_DWA_DATE
            }

            val pdfFile = createPdfDocumentFile(items, dwa, dateStr)
            val uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                pdfFile
            )

            val shareSubject = if (items.size > 1) {
                "Annexure-11 Work Completion Certificates (${items.size} Pending Substations)"
            } else {
                "Annexure-11 Work Completion Certificate - ${items.firstOrNull()?.substationName}"
            }

            val shareText = if (items.size > 1) {
                "Attached is the combined Annexure-11 Work Completion Certificates PDF for all ${items.size} pending substations."
            } else {
                "Attached is the Annexure-11 Work Completion Certificate for ${items.firstOrNull()?.substationName} Substation."
            }

            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                type = "application/pdf"
                putExtra(Intent.EXTRA_STREAM, uri)
                putExtra(Intent.EXTRA_SUBJECT, shareSubject)
                putExtra(Intent.EXTRA_TEXT, shareText)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = Intent.createChooser(shareIntent, "Share Annexure-11 Certificate")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(chooser)

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun viewAnnexurePdf(options: ReadableMap, promise: Promise) {
        try {
            val items = extractStationItems(options)
            val dwa = if (options.hasKey("dwaNo") && !options.getString("dwaNo").isNullOrBlank()) {
                options.getString("dwaNo") ?: DEFAULT_DWA_NO
            } else {
                DEFAULT_DWA_NO
            }
            val dateStr = if (options.hasKey("date") && !options.getString("date").isNullOrBlank()) {
                options.getString("date") ?: DEFAULT_DWA_DATE
            } else {
                DEFAULT_DWA_DATE
            }

            val pdfFile = createPdfDocumentFile(items, dwa, dateStr)
            val uri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                pdfFile
            )

            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/pdf")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            val chooser = Intent.createChooser(viewIntent, "Open Annexure-11 Certificate")
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            reactContext.startActivity(chooser)

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VIEW_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun printAnnexure(options: ReadableMap, promise: Promise) {
        try {
            val items = extractStationItems(options)
            val dwa = if (options.hasKey("dwaNo") && !options.getString("dwaNo").isNullOrBlank()) {
                options.getString("dwaNo") ?: DEFAULT_DWA_NO
            } else {
                DEFAULT_DWA_NO
            }
            val dateStr = if (options.hasKey("date") && !options.getString("date").isNullOrBlank()) {
                options.getString("date") ?: DEFAULT_DWA_DATE
            } else {
                DEFAULT_DWA_DATE
            }

            val html = generateHtml(items, dwa, dateStr)

            UiThreadUtil.runOnUiThread {
                val currentActivity = reactContext.currentActivity
                if (currentActivity == null) {
                    promise.reject("NO_ACTIVITY", "Current activity is null, cannot trigger print")
                    return@runOnUiThread
                }

                val printManager = currentActivity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
                if (printManager == null) {
                    promise.reject("PRINT_ERROR", "PrintManager service is unavailable")
                    return@runOnUiThread
                }

                val webView = WebView(currentActivity)
                webView.webViewClient = object : WebViewClient() {
                    override fun onPageFinished(view: WebView?, url: String?) {
                        val jobName = if (items.size > 1) {
                            "Annexure-11_All_Pending_${items.size}Stations"
                        } else {
                            val safeName = getSanitizedStationName(items.firstOrNull()?.substationName)
                            "Annexure-11_${safeName}"
                        }
                        val printAdapter = webView.createPrintDocumentAdapter(jobName)
                        printManager.print(jobName, printAdapter, PrintAttributes.Builder().build())
                        promise.resolve(true)
                    }
                }
                webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
            }
        } catch (e: Exception) {
            promise.reject("PRINT_ERROR", e.message, e)
        }
    }
}
