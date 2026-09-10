// `java` désigne l'extension Gradle dans ce fichier: on importe la classe
// pour pouvoir lire local.properties sans écrire java.util.Properties.
import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
}

android {
  namespace = "tn.maawen.app"
  compileSdk = 35

  defaultConfig {
    applicationId = "tn.maawen.app"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "1.0"

    // Renseigne ces deux valeurs dans android/local.properties:
    //   supabase.url=https://xxxx.supabase.co
    //   supabase.anonKey=eyJ...
    val props = Properties().apply {
      val f = rootProject.file("local.properties")
      if (f.exists()) f.inputStream().use { load(it) }
    }
    buildConfigField("String", "SUPABASE_URL", "\"${props.getProperty("supabase.url", "")}\"")
    buildConfigField("String", "SUPABASE_ANON_KEY", "\"${props.getProperty("supabase.anonKey", "")}\"")
  }

  buildFeatures {
    compose = true
    buildConfig = true
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
  implementation(composeBom)

  implementation("androidx.core:core-ktx:1.13.1")
  implementation("androidx.activity:activity-compose:1.9.3")
  implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
  implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
  implementation("androidx.compose.ui:ui")
  implementation("androidx.compose.material3:material3")
  implementation("androidx.compose.material:material-icons-core")
  implementation("androidx.compose.ui:ui-tooling-preview")
  implementation("androidx.browser:browser:1.8.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

  debugImplementation("androidx.compose.ui:ui-tooling")
}
