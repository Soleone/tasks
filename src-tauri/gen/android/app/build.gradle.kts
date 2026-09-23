import org.gradle.api.GradleException
import java.security.KeyStore
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties()
if (keystorePropertiesFile.isFile) {
    try {
        keystorePropertiesFile.inputStream().use { keystoreProperties.load(it) }
    } catch (_: Exception) {
        throw GradleException(
            "Unable to read src-tauri/gen/android/keystore.properties. Check its local permissions and properties format."
        )
    }
}

val releaseSigningPropertyNames = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
val releaseSigningPropertiesPresent = keystorePropertiesFile.isFile &&
    releaseSigningPropertyNames.all { !keystoreProperties.getProperty(it).isNullOrBlank() }

fun validateReleaseSigningProperties() {
    val missingProperties = releaseSigningPropertyNames.filter { keystoreProperties.getProperty(it).isNullOrBlank() }
    if (!keystorePropertiesFile.isFile || missingProperties.isNotEmpty()) {
        val missing = buildList {
            if (!keystorePropertiesFile.isFile) add("keystore.properties")
            addAll(missingProperties)
        }
        throw GradleException(
            "Android release signing is required. Missing: ${missing.joinToString()}. " +
                "Create src-tauri/gen/android/keystore.properties using the Signed Android release APK instructions " +
                "in docs/development.md. Never commit the properties file or keystore."
        )
    }

    val storeFile = project.file(keystoreProperties.getProperty("storeFile").orEmpty())
    if (!storeFile.isFile) {
        throw GradleException(
            "Android signing keystore file was not found. Check storeFile in " +
                "src-tauri/gen/android/keystore.properties."
        )
    }

    val storePassword = keystoreProperties.getProperty("storePassword").orEmpty()
    val keyAlias = keystoreProperties.getProperty("keyAlias").orEmpty()
    val keyPassword = keystoreProperties.getProperty("keyPassword").orEmpty()
    val keyStore = try {
        KeyStore.getInstance(storeFile, storePassword.toCharArray())
    } catch (_: Exception) {
        throw GradleException(
            "Unable to open the Android signing keystore. Check storeFile and storePassword in " +
                "src-tauri/gen/android/keystore.properties."
        )
    }

    if (!keyStore.isKeyEntry(keyAlias)) {
        throw GradleException(
            "The Android signing keystore has no private key for the configured alias. Check keyAlias in " +
                "src-tauri/gen/android/keystore.properties."
        )
    }

    val signingKey = try {
        keyStore.getKey(keyAlias, keyPassword.toCharArray())
    } catch (_: Exception) {
        null
    }
    if (signingKey !is java.security.PrivateKey) {
        throw GradleException(
            "Unable to unlock a private Android signing key. Check keyAlias and keyPassword in " +
                "src-tauri/gen/android/keystore.properties."
        )
    }
}

val validateReleaseSigning = tasks.register("validateReleaseSigning") {
    group = "verification"
    description = "Validates the local keystore used for Android release signing."
    doLast { validateReleaseSigningProperties() }
}

tasks.configureEach {
    val taskName = name.lowercase()
    val isReleasePreparationTask = taskName.startsWith("pre") && taskName.endsWith("releasebuild")
    val isReleaseSigningTask = taskName.startsWith("validatesigning") && taskName.endsWith("release")
    val releaseArtifactPrefixes = listOf("assemble", "bundle", "package", "install")
    val isReleaseArtifactTask = taskName.endsWith("release") &&
        releaseArtifactPrefixes.any { taskName.startsWith(it) }
    if (isReleasePreparationTask || isReleaseSigningTask || isReleaseArtifactTask) {
        dependsOn(validateReleaseSigning)
    }
}

android {
    compileSdk = 36
    namespace = "com.soleone.tasks"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.soleone.tasks"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (releaseSigningPropertiesPresent) {
            create("release") {
                storeFile = file(keystoreProperties.getProperty("storeFile").orEmpty())
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            if (releaseSigningPropertiesPresent) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")