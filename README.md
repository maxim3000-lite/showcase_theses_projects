# Portfolio-Website

Statische Website aus HTML, CSS und Vanilla-JS. Sie braucht keinen Build-Schritt und lädt keine externen Abhängigkeiten. Die 3D-Szenen rendert eine eigene, kleine WebGL-Engine.

## Starten

Öffne `index.html` direkt im Browser oder starte einen lokalen Server:

```powershell
python -m http.server 8000
# → http://localhost:8000
```

## Struktur

| Datei | Inhalt |
| --- | --- |
| `index.html` | PhD (Startseite) mit 3D-Scrollytelling; alle Seiten sind auf Englisch, nur die Datenschutzerklärung ist deutsch |
| `masterarbeit.html` / `bachelorarbeit.html` | Abschlussarbeiten mit gleicher Struktur; 3D-Objekt: Lenkgetriebe bzw. Pleuel |
| `kontakt.html` | Kontakt (nur LinkedIn), ohne 3D-Bühne |
| `impressum.html`, `datenschutz.html` | Impressum und Datenschutzerklärung, ohne 3D-Bühne; per `noindex, nofollow` von Suchmaschinen ausgenommen; verlinkt nur im Footer |
| `assets/css/style.css` | Design-Tokens (hell/dunkel), Layout, Komponenten, 3D-Bühne |
| `assets/js/main.js` | Schreibmaschinen-Effekt, Koordinaten/Info-Fenster, Detailgrafiken, Fallbacks |
| `assets/js/stage/core.js` | WebGL-Renderer (Punkte, Linien, Dreiecke), Matrizen, Colormap |
| `assets/js/stage/car.js` | modernes Fahrzeug (Fastback): Karosserie-Loft, gleichmäßiges FE-Netz (Bogenlänge), vernetzte Räder, CAD-Linien, Bemaßung |
| `assets/js/stage/structure.js` | Crashstruktur als FE-Netze: Längsträger → Schweller und Obergurt → A-Säule → Dachrahmen jeweils durchgehend (Dachrahmen und B-Säule aus der Karosseriefläche abgeleitet), Crashboxen, Fahrschemel, Stirnwand, Motor, BKV, Zickzack-Riss an der Fügestelle + Lastpfade |
| `assets/js/stage/crash.js` | Crash-Kinematik: Crashbox-Faltung; Variante A: Längsträger knickt einseitig aus, Variante B: Faltenbeulen; Hauben-Zelt, Motor/BKV kippen in die Stirnwand, Riss öffnet sich, Heckanhebung, Rückfederung |
| `assets/js/stage/meshset.js` | strukturierte Netze verformen, Normalen, indizierte Dreiecke/Kanten |
| `assets/js/stage/objects.js` | Objekte der Unterseiten als FE-Netze: Zahnstangenlenkung (Master, mit Härtekontur am Ritzel und Lenkbewegung) und Pleuel (Bachelor: Schraubenaugen mit Gewinde-Sackloch im Schaft und Durchgangsbohrung im Deckel, Keil, Crackdorne, Riss, eiförmiger Verzug der Bohrung gegen den Idealkreis – überhöht –, Bruchflächen, Verschraubung im Röntgenblick) |
| `assets/js/stage/forms.js` | Partikel-Formationen: Karte, Data Lake, Tesserakt, Lauf-Raum (Anomalieerkennung), Knowledge Graph, Lenkgetriebe, Motor |
| `assets/js/stage/timelines.js` | Drehbücher: Kamera und Zustand je Abschnitt |
| `assets/js/stage/stage.js` | Scroll-Steuerung, Übergänge, Labels, FE-HUD |

## So funktioniert die 3D-Bühne

- Jedes Element mit `data-scene="…"` ist ein Abschnitt im Drehbuch. In `timelines.js` stehen pro Abschnitt Kamera (`eye`, `tgt`, `fov`, `shift`) und Zustände wie `phi` (Formation), `drive` (Fahrweg bzw. Crash), `wire`, `mesh`, `fringe` oder `xray`. Beim Scrollen wird zwischen den Werten weich interpoliert.
- Am Anfang besteht die Punktewolke aus den Stationen im Lebenslauf (Wien, Leoben, Steyr, Schwäbisch Gmünd, Wolfsburg; Liste `STATIONS` in `forms.js`). Sie erscheinen im Intro nacheinander, verbunden durch eine Route. Beim Scrollen fliegen sie chronologisch los; jede Station baut einen Abschnitt des Fahrzeugs (Wien → Heck … Wolfsburg → Front).
- Danach sind die Partikel nach x sortiert, damit jeder Punkt kohärent an seinen neuen Platz fließt: Karosserie → Data Lake → Tesserakt → Karosserie → Lauf-Raum → Karosserie → Graph.
- Alle Darstellungen sind schematisch und keine echten Simulationsdaten.
- **Textführung:** Im 3D-Modus verschiebt `main.js` den Inhalt jedes Abschnitts in ein festes Fenster oben rechts (`.deck`). Sichtbar ist der aktuelle Abschnitt; beim ersten Öffnen wird er eingetippt, danach bleibt er stehen. Das Fenster scrollt nie: Passt ein Abschnitt nicht, wird seine Schrift verkleinert (`zoom`). Mit `data-pin="title"` bleibt der Steckbrief (Seite 2) über der Complication (⚡) und der Solution (💡) stehen. Bauteil-Labels hängen weiterhin direkt an der 3D-Szene.
- **Barrierefreiheit:** Der Canvas ist dekorativ (`aria-hidden`), alle Inhalte stehen im HTML. Bei reduzierter Bewegung entfallen Intro, Leerlauf-Animationen und Glättung.
- **Fallback:** Ohne WebGL oder mit „3D-Ansicht ausschalten“ (wird im Browser gespeichert) erscheint das klassische Layout mit SVG-Karte.

## Noch zu ergänzen

Suche nach `[` in den HTML-Dateien: Auf der PhD-Seite fehlt noch die Modellvariante („From change to effect“). Kontakt läuft bewusst über LinkedIn; die E-Mail-Adresse steht nur in Impressum und Datenschutzerklärung. Firmenlogos werden bewusst nicht verwendet.

## Vor dem Veröffentlichen

Die Seite läuft über GitHub Pages: Alles, was im Repository liegt, ist öffentlich – auch diese README. `images/` (Referenzbilder, Arbeitsunterlagen) ist deshalb per `.gitignore` ausgeschlossen. Die Abschluss-PDFs (`masterarbeit_ENDVERSION.pdf`, `Bachelorarbeit_Neururer_Pleuelcracken.pdf`) gehören ebenfalls nicht ins Repository; sie enthalten unter anderem Unterschrift, Matrikelnummer und Danksagung.

Die Datenschutzerklärung beschreibt Hosting über GitHub Pages ohne Analyse-Dienste. Kommen Dienste dazu (Schriften, Videos, Karten, Statistik o. Ä.), muss `datenschutz.html` angepasst werden. Impressum und Datenschutzerklärung tragen `noindex, nofollow`; nicht zusätzlich per `robots.txt` sperren, sonst sieht Google das `noindex` nicht.
