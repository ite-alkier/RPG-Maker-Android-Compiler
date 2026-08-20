package com.rpgmakercompiler.wrapper;

import android.app.Activity;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Schlanker nativer WebView-Wrapper fuer RPG Maker MV/MZ Web-Exporte.
 *
 * Laedt das Spiel bewusst ueber file:///android_asset/ statt ueber einen
 * Bridge-Mechanismus mit virtueller https-Adresse (wie es z.B. Capacitor
 * verwendet) -- letzteres hat sich in der Praxis als Ursache fuer einen
 * dauerhaft haengenden Ladebildschirm bei RPG-Maker-Exporten erwiesen.
 * Der direkte file://-Zugriff mit den unten gesetzten Berechtigungen ist
 * der nachweislich funktionierende, einfachere Weg.
 */
public class MainActivity extends Activity {

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fuer chrome://inspect Remote-Debugging waehrend der Entwicklung.
        WebView.setWebContentsDebuggingEnabled(true);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);

        // RPG Maker MV/MZ laedt Spieldaten (JSON, Bilder) lokal per
        // XMLHttpRequest/fetch -- ohne diese drei Einstellungen blockiert
        // Android das lautlos (keine Fehlermeldung, die Anfrage haengt
        // einfach fest).
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        // Speicherstaende: RPG Maker MV/MZ nutzt ausserhalb von NW.js den
        // Browser-localStorage als Speicherort. WebViews haben DOM-Storage
        // standardmaessig AUS (anders als normale Browser) -- ohne dies
        // wuerden Spielstaende nicht persistiert werden.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);

        // Manche Android-WebView-Versionen blockieren Audiowiedergabe ohne
        // vorherige, garantiert erkannte Nutzer-Geste. Das kann in seltenen
        // Faellen fuer haengende Ladevorgaenge sorgen, wenn RPG Maker MZ auf
        // die Audio-Initialisierung wartet.
        settings.setMediaPlaybackRequiresUserGesture(false);

        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                // RPG Maker MV/MZ wartet auf eine erste Eingabe (Tap/Klick/
                // Taste), bevor es u.a. die Audiowiedergabe freischaltet --
                // eine gaengige Absicherung gegen automatisch startenden
                // Ton. Wir loesen dafuer synthetische Ereignisse direkt auf
                // "document" aus -- bewusst OHNE feste Bildschirm-
                // Koordinaten, da eine Umrechnung von Android-View-Pixeln
                // auf die tatsaechliche Canvas-Position je nach Skalierung
                // des WebViews leicht daneben liegen kann. RPG Makers
                // eigene Ereignis-Behandlung lauscht ohnehin dokumentweit,
                // nicht auf eine bestimmte Position.
                simulateInputDelayed(700);
                simulateInputDelayed(1500);
                simulateInputDelayed(3000);
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        setFullScreen();

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            setFullScreen();
        }
    }

    private void setFullScreen() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
    }

    // Leitet den Hardware-"Zurueck"-Knopf als Escape-Taste ins Spiel
    // weiter, da RPG Maker MV/MZ darueber Menues schliesst/abbricht --
    // fuehlt sich fuer Spieler:innen intuitiver an als ein sofortiges
    // Beenden der App.
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.evaluateJavascript(
                "document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: 27, which: 27, bubbles: true}));",
                null
            );
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    private void simulateTapDelayed(long delayMillis) {
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                simulateTap(1f, 1f);
            }
        }, delayMillis);
    }

    private void simulateInputDelayed(long delayMillis) {
        webView.postDelayed(new Runnable() {
            @Override
            public void run() {
                simulateTap(1f, 1f);
                simulateJsEvents();
            }
        }, delayMillis);
    }

    // Loest synthetische Touch-/Maus-/Tasten-Ereignisse direkt auf
    // "document" aus -- ohne Bezug auf eine bestimmte Bildschirm-Position.
    // RPG Maker MV/MZ registriert seine "warte auf erste Eingabe"-Logik
    // typischerweise dokumentweit (z.B. document.addEventListener('touchend', ...)),
    // daher reicht ein Ereignis auf "document" unabhaengig davon, wo genau
    // die Canvas auf dem Bildschirm positioniert/skaliert ist.
    private void simulateJsEvents() {
        String js =
            "(function(){" +
            "try{" +
            "var opts={bubbles:true,cancelable:true};" +
            // Bewusst KEINE synthetischen touchstart/touchend Events:
            // ein simples "new Event('touchstart')" hat kein
            // changedTouches (das nur ein echtes TouchEvent hat), was in
            // RPG Makers eigenem Touch-Handler zu einem unabgefangenen
            // "changedTouches is not iterable" Fehler fuehrt. Maus- und
            // Tasten-Ereignisse loesen dieselbe "warte auf Eingabe"-Logik
            // aus, ohne dieses Kompatibilitaetsproblem.
            "document.dispatchEvent(new MouseEvent('mousedown',opts));" +
            "document.dispatchEvent(new MouseEvent('mouseup',opts));" +
            "document.dispatchEvent(new MouseEvent('click',opts));" +
            "document.dispatchEvent(new KeyboardEvent('keydown',{keyCode:13,which:13,bubbles:true}));" +
            "document.dispatchEvent(new KeyboardEvent('keyup',{keyCode:13,which:13,bubbles:true}));" +
            "if(window.AudioContext||window.webkitAudioContext){" +
            "  var Ctx=window.AudioContext||window.webkitAudioContext;" +
            "  if(!window._rpgCompilerAudioUnlockCtx){" +
            "    window._rpgCompilerAudioUnlockCtx=new Ctx();" +
            "  }" +
            "  if(window._rpgCompilerAudioUnlockCtx.state==='suspended'){" +
            "    window._rpgCompilerAudioUnlockCtx.resume();" +
            "  }" +
            "}" +
            "}catch(e){}" +
            "})();";
        webView.evaluateJavascript(js, null);
    }

    // Simuliert zusaetzlich einen echten Fingertipp an der uebergebenen
    // Position ueber die tatsaechliche Android-Touch-Pipeline (statt nur
    // ein JavaScript-Ereignis). Standardmaessig wird oben links (1,1)
    // angetippt statt der Bildschirmmitte -- bei RPG-Maker-Exporten liegt
    // die tatsaechlich "aktive" Flaeche fuer die erste Eingabe aufgrund
    // von WebView-Skalierungseffekten teils nicht exakt dort, wo man es
    // erwarten wuerde; eine feste Ecke funktioniert unabhaengig von
    // Quer-/Hochformat und Bildschirmgroesse zuverlaessiger als die Mitte.
    private void simulateTap(float x, float y) {
        int width = webView.getWidth();
        int height = webView.getHeight();
        if (width == 0 || height == 0) return; // WebView noch nicht vermessen

        long downTime = SystemClock.uptimeMillis();

        MotionEvent downEvent = MotionEvent.obtain(
            downTime, downTime, MotionEvent.ACTION_DOWN, x, y, 0
        );
        webView.dispatchTouchEvent(downEvent);
        downEvent.recycle();

        long upTime = SystemClock.uptimeMillis();
        MotionEvent upEvent = MotionEvent.obtain(
            downTime, upTime, MotionEvent.ACTION_UP, x, y, 0
        );
        webView.dispatchTouchEvent(upEvent);
        upEvent.recycle();
    }
}
