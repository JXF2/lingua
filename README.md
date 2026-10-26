# Lingua (Web)

Web-Version der Sprachlern-App Lingua – Französisch, Englisch und Deutsch, A1 bis C2.
Läuft im Browser und lässt sich auf dem iPhone über Safari › Teilen › „Zum Home-Bildschirm“ wie eine App installieren (auch offline).

Die Kursinhalte (`content.json`) werden aus der Android-App erzeugt:

```
EXPORT_WEB=1 ./gradlew :app:testDebugUnitTest --tests "com.example.lingua.data.WebExport"
```

Der Lernfortschritt liegt nur im Browser des Geräts (localStorage).
