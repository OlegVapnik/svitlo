# Native Android sources

Kotlin sources that are copied into the generated Android project by the Expo config plugins in
`plugins/`. They are not part of the JS bundle, but they are what makes the app feel native:
widgets with a live countdown, a quick-settings tile, a persistent status notification, and the
OTA bundle swap.

| Path | Purpose |
| --- | --- |
| `java/ua/com/svitlo/app/AppRestartModule.kt` | Reload the JS runtime after an update |
| `java/ua/com/svitlo/app/OtaBundle.kt` | Atomic download, verify and activate of JS bundles |
| `java/ua/com/svitlo/app/widget/` | App widgets: provider, alarm worker, metrics, payload |
| `java/ua/com/svitlo/app/live/` | Quick-settings tile, ongoing notification, lock-screen status |

Keep the package name (`ua.com.svitlo.app`) in sync with `app.json` → `expo.android.package`;
the config plugins copy the tree into `android/app/src/main/java/…` during `expo prebuild`.
