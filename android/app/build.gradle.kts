plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "tn.maawen.app"
  compileSdk = 35

  defaultConfig {
    applicationId = "tn.maawen.app"
    minSdk = 24
    targetSdk = 35
    versionCode = 1
    versionName = "1.0"

    // Adresse par défaut du serveur de l'agent. Modifiable dans l'app
    // (bouton « بدّل السرفور ») — 10.0.2.2 = le PC hôte vu depuis l'émulateur.
    buildConfigField("String", "DEFAULT_SERVER", "\"http://10.0.2.2:3000\"")
  }

  buildFeatures { buildConfig = true }

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

// Volontairement sans dépendance: l'app n'utilise que le framework Android.
dependencies {}
