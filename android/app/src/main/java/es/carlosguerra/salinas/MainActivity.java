package es.carlosguerra.salinas;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(ImmersivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
