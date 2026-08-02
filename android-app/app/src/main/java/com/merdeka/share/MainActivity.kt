package com.merdeka.share

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.google.android.material.snackbar.Snackbar
import com.merdeka.share.databinding.ActivityMainBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var auth: AuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        auth = AuthManager(this)

        binding.baseUrlInput.setText(auth.baseUrl)

        binding.loginButton.setOnClickListener { doLogin() }
        binding.logoutButton.setOnClickListener {
            auth.logout()
            renderState()
            Snackbar.make(binding.root, "Sudah logout", Snackbar.LENGTH_SHORT).show()
        }
        binding.openOmsButton.setOnClickListener {
            val url = auth.baseUrl
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            } catch (e: Exception) {
                Snackbar.make(binding.root, "Tidak bisa membuka browser", Snackbar.LENGTH_SHORT).show()
            }
        }
        binding.refreshButton.setOnClickListener { loadTodayList() }

        renderState()
    }

    override fun onResume() {
        super.onResume()
        if (auth.isLoggedIn()) loadTodayList()
    }

    private fun renderState() {
        if (auth.isLoggedIn()) {
            binding.loginCard.visibility = View.GONE
            binding.homeCard.visibility = View.VISIBLE
            binding.welcomeText.text = "Hai ${auth.userName ?: "-"}  •  ${auth.userRole ?: "-"}"
            binding.baseUrlDisplay.text = auth.baseUrl
            loadTodayList()
        } else {
            binding.loginCard.visibility = View.VISIBLE
            binding.homeCard.visibility = View.GONE
        }
    }

    private fun doLogin() {
        val baseUrl = binding.baseUrlInput.text?.toString()?.trim()?.trimEnd('/').orEmpty()
        val username = binding.usernameInput.text?.toString()?.trim().orEmpty()
        val password = binding.passwordInput.text?.toString().orEmpty()
        if (baseUrl.isEmpty() || username.isEmpty() || password.isEmpty()) {
            Snackbar.make(binding.root, "Isi base URL, username, dan password", Snackbar.LENGTH_SHORT).show()
            return
        }
        binding.loginButton.isEnabled = false
        binding.loginProgress.visibility = View.VISIBLE

        lifecycleScope.launch {
            val result = withContext(Dispatchers.IO) {
                ApiClient.login(baseUrl, username, password)
            }
            binding.loginButton.isEnabled = true
            binding.loginProgress.visibility = View.GONE
            if (result.ok && result.token != null) {
                auth.baseUrl = baseUrl
                auth.token = result.token
                auth.userName = result.name
                auth.userRole = result.role
                renderState()
                Snackbar.make(binding.root, "Login berhasil", Snackbar.LENGTH_SHORT).show()
            } else {
                Snackbar.make(binding.root, result.error ?: "Login gagal", Snackbar.LENGTH_LONG).show()
            }
        }
    }

    private fun loadTodayList() {
        val token = auth.token ?: return
        val baseUrl = auth.baseUrl
        binding.listProgress.visibility = View.VISIBLE
        lifecycleScope.launch {
            val today = witaToday()
            val items = withContext(Dispatchers.IO) {
                ApiClient.listTodayPdfs(baseUrl, token, today)
            }
            binding.listProgress.visibility = View.GONE
            binding.countText.text = "${items.size} PDF terupload hari ini ($today WITA)"
            binding.listContainer.removeAllViews()
            items.sortedByDescending { it.uploadedAt }.forEach { item ->
                val tv = android.widget.TextView(this@MainActivity).apply {
                    text = "• ${item.filename}  —  ${item.pagesCount} hlm  •  ${item.detectedCount} resi"
                    setPadding(0, 8, 0, 8)
                    textSize = 14f
                }
                binding.listContainer.addView(tv)
            }
        }
    }

    private fun witaToday(): String {
        val tz = TimeZone.getTimeZone("Asia/Makassar")
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        fmt.timeZone = tz
        return fmt.format(Date())
    }
}
