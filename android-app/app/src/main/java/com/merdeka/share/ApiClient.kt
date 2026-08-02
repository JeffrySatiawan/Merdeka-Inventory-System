package com.merdeka.share

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class LoginResult(
    val ok: Boolean,
    val token: String? = null,
    val name: String? = null,
    val role: String? = null,
    val modules: List<String> = emptyList(),
    val error: String? = null
)

data class UploadResult(
    val ok: Boolean,
    val filename: String? = null,
    val id: String? = null,
    val error: String? = null
)

data class PdfItem(
    val id: String,
    val filename: String,
    val uploadedAt: String,
    val uploadedWitaDate: String,
    val pagesCount: Int,
    val detectedCount: Int
)

object ApiClient {

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    fun login(baseUrl: String, username: String, password: String): LoginResult {
        return try {
            val body = JSONObject().apply {
                put("username", username)
                put("password", password)
            }.toString().toRequestBody("application/json".toMediaType())

            val req = Request.Builder()
                .url("$baseUrl/api/auth/login")
                .post(body)
                .build()

            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val msg = try { JSONObject(text).optString("error", "Login gagal") }
                    catch (_: Exception) { "Login gagal (HTTP ${resp.code})" }
                    return@use LoginResult(false, error = msg)
                }
                val json = JSONObject(text)
                val token = json.optString("token").takeIf { it.isNotEmpty() }
                val user = json.optJSONObject("user")
                val name = user?.optString("name")
                val role = user?.optString("role")
                val modules = mutableListOf<String>()
                user?.optJSONArray("modules")?.let { arr ->
                    for (i in 0 until arr.length()) modules.add(arr.optString(i))
                }
                if (token == null) LoginResult(false, error = "Token tidak diterima")
                else LoginResult(true, token, name, role, modules)
            }
        } catch (e: Exception) {
            LoginResult(false, error = e.message ?: "Network error")
        }
    }

    fun uploadPdf(baseUrl: String, token: String, filename: String, bytes: ByteArray): UploadResult {
        return try {
            val safeName = if (filename.lowercase().endsWith(".pdf")) filename else "$filename.pdf"

            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart(
                    "file",
                    safeName,
                    bytes.toRequestBody("application/pdf".toMediaType())
                )
                .build()

            val req = Request.Builder()
                .url("$baseUrl/api/om/pdfs/auto")
                .addHeader("Authorization", "Bearer $token")
                .post(body)
                .build()

            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) {
                    val msg = try { JSONObject(text).optString("error", "Upload gagal") }
                    catch (_: Exception) { "Upload gagal (HTTP ${resp.code})" }
                    return@use UploadResult(false, error = msg)
                }
                val json = JSONObject(text)
                val item = json.optJSONObject("item")
                UploadResult(
                    ok = true,
                    filename = item?.optString("filename"),
                    id = item?.optString("id")
                )
            }
        } catch (e: Exception) {
            UploadResult(false, error = e.message ?: "Network error")
        }
    }

    fun listTodayPdfs(baseUrl: String, token: String, todayDate: String): List<PdfItem> {
        return try {
            val req = Request.Builder()
                .url("$baseUrl/api/om/pdfs")
                .addHeader("Authorization", "Bearer $token")
                .get()
                .build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return emptyList()
                val text = resp.body?.string() ?: return emptyList()
                val json = JSONObject(text)
                val items: JSONArray = json.optJSONArray("items") ?: return emptyList()
                val out = mutableListOf<PdfItem>()
                for (i in 0 until items.length()) {
                    val it = items.optJSONObject(i) ?: continue
                    if (it.optString("uploaded_wita_date") != todayDate) continue
                    out.add(
                        PdfItem(
                            id = it.optString("id"),
                            filename = it.optString("filename"),
                            uploadedAt = it.optString("uploaded_at"),
                            uploadedWitaDate = it.optString("uploaded_wita_date"),
                            pagesCount = it.optInt("pages_count", 0),
                            detectedCount = it.optJSONArray("detected_tracking_numbers")?.length() ?: 0
                        )
                    )
                }
                out
            }
        } catch (e: Exception) {
            emptyList()
        }
    }
}
