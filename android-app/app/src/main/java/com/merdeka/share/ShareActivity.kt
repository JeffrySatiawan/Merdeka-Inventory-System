package com.merdeka.share

import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.merdeka.share.databinding.ActivityShareBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * ShareActivity — Native Android share target for PDF files.
 *
 * Registered in AndroidManifest with intent-filter for:
 *   - android.intent.action.SEND (mimeType application/pdf)
 *   - android.intent.action.SEND_MULTIPLE (mimeType application/pdf)
 *
 * This is a REAL native Android share target using standard Intent — it is NOT
 * Web Share Target API and does NOT rely on PWA / Service Worker.
 */
class ShareActivity : AppCompatActivity() {

    private lateinit var binding: ActivityShareBinding
    private lateinit var auth: AuthManager
    private var successCount = 0
    private var failCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityShareBinding.inflate(layoutInflater)
        setContentView(binding.root)
        auth = AuthManager(this)

        val uris = extractUris(intent)

        // No PDF? show close only.
        if (uris.isEmpty()) {
            binding.statusText.text = "Tidak ada file PDF yang di-share"
            binding.progressBar.visibility = View.GONE
            binding.closeButton.visibility = View.VISIBLE
            binding.closeButton.setOnClickListener { finish() }
            return
        }

        // Not logged in? show open-app button.
        if (!auth.isLoggedIn()) {
            binding.statusText.text = "Belum login. Buka aplikasi Merdeka Share dulu untuk login."
            binding.progressBar.visibility = View.GONE
            binding.openAppButton.visibility = View.VISIBLE
            binding.closeButton.visibility = View.VISIBLE
            binding.openAppButton.setOnClickListener {
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
            binding.closeButton.setOnClickListener { finish() }
            return
        }

        binding.statusText.text = "Mengunggah ${uris.size} PDF..."
        uploadAll(uris)
    }

    private fun extractUris(intent: Intent): List<Uri> {
        val action = intent.action ?: return emptyList()
        val out = mutableListOf<Uri>()
        when (action) {
            Intent.ACTION_SEND -> {
                val uri: Uri? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_STREAM)
                }
                uri?.let { out.add(it) }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val list: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                }
                list?.let { out.addAll(it) }
            }
        }
        return out
    }

    private fun uploadAll(uris: List<Uri>) {
        val baseUrl = auth.baseUrl
        val token = auth.token ?: run {
            binding.statusText.text = "Token hilang. Buka aplikasi untuk login ulang."
            binding.progressBar.visibility = View.GONE
            binding.closeButton.visibility = View.VISIBLE
            binding.closeButton.setOnClickListener { finish() }
            return
        }

        lifecycleScope.launch {
            uris.forEachIndexed { idx, uri ->
                binding.statusText.text = "Mengunggah ${idx + 1}/${uris.size}..."
                val result = withContext(Dispatchers.IO) {
                    try {
                        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                            ?: return@withContext UploadResult(false, error = "Gagal baca file")
                        val filename = queryFilename(uri) ?: "resi.pdf"
                        ApiClient.uploadPdf(baseUrl, token, filename, bytes)
                    } catch (e: Exception) {
                        UploadResult(false, error = e.message ?: "Error")
                    }
                }
                if (result.ok) {
                    successCount++
                    addLog("\u2713 ${result.filename ?: "OK"}", true)
                } else {
                    failCount++
                    addLog("\u2717 ${result.error ?: "Gagal"}", false)
                }
            }

            binding.progressBar.visibility = View.GONE
            binding.statusText.text = if (failCount == 0) {
                "Berhasil upload $successCount PDF \u2713"
            } else {
                "Selesai. Berhasil: $successCount, Gagal: $failCount"
            }
            binding.closeButton.visibility = View.VISIBLE
            binding.closeButton.setOnClickListener { finish() }

            // Auto-close after 2.5s if all upload succeeded
            if (failCount == 0) {
                binding.root.postDelayed({ if (!isFinishing) finish() }, 2500L)
            }
        }
    }

    private fun queryFilename(uri: Uri): String? {
        return try {
            var name: String? = null
            contentResolver.query(uri, null, null, null, null)?.use { c: Cursor ->
                if (c.moveToFirst()) {
                    val idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (idx >= 0) name = c.getString(idx)
                }
            }
            name
        } catch (e: Exception) {
            null
        }
    }

    private fun addLog(line: String, ok: Boolean) {
        val tv = TextView(this).apply {
            text = line
            textSize = 13f
            setPadding(0, 4, 0, 4)
            setTextColor(if (ok) 0xFF10B981.toInt() else 0xFFEF4444.toInt())
        }
        binding.logContainer.addView(tv)
    }
}
