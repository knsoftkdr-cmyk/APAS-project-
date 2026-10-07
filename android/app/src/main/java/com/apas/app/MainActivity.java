package com.apas.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {

    private static final int MIC_PERMISSION_REQUEST_CODE = 9001;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();

        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(true);

        // Ask the user for the Android runtime microphone permission up front,
        // so the WebView's getUserMedia() / SpeechRecognition calls don't just
        // silently fail with "not-allowed".
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                    this,
                    new String[]{Manifest.permission.RECORD_AUDIO},
                    MIC_PERMISSION_REQUEST_CODE
            );
        }

        // Let the WebView itself grant any in-page mic permission requests
        // (this is what the browser's SpeechRecognition/getUserMedia API needs).
        // Extend Capacitor's own client (a bare WebChromeClient drops the file
        // chooser and geolocation prompt handling).
        webView.setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                String[] resources = request.getResources();
                if (resources.length == 1
                        && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resources[0])) {
                    runOnUiThread(() -> request.grant(resources));
                    return;
                }
                // Camera and everything else: let Capacitor handle it.
                super.onPermissionRequest(request);
            }
        });
    }
}