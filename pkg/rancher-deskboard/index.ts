import { importTypes } from '@rancher/auto-import';
import { IInternal, IPlugin } from '@shell/core/types';
import Socket from '@shell/utils/socket';

// Steve's HTTPS port, fetched asynchronously from the DashboardServer
// at plugin init. The interceptors below are registered synchronously
// but read stevePort at request time (inside the interceptor callbacks),
// so the async fetch completes before the dashboard UI renders and
// starts making API calls. If the fetch fails, stevePort stays empty
// and the interceptors pass URLs through unmodified.
let stevePort = '';

// Init the package
export default function(plugin: IPlugin, internal: IInternal): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  const { $axios, store, app: { router } } = internal;

  // Fire-and-forget: the result is stored in the module-level stevePort
  // variable before any intercepted request runs. Not awaited because
  // the plugin init function is synchronous.
  fetchStevePort($axios);
  interceptApiRequest($axios);
  interceptWebSocketUrls();

  let logoRoute = router.resolve({
    name: 'c-cluster-explorer',
    params: { cluster: "local" },
  });

  store.commit('setIsSingleProduct', {
    productNameKey: 'rancher-desktop.label',
    logoRoute,
    logo: require(`./assets/logo.svg`),
  });

  // Hide buttons in the header that don't work in Rancher Desktop.
  // KubeConfig buttons don't function (issues #2208) and Kubectl Shell
  // is not useful since users can use a local terminal (issue #8151).
  store.commit('type-map/product', {
    name:           'explorer',
    hideKubeShell:  true,
    hideKubeConfig: true,
    hideCopyConfig: true,
  });
}

/**
 * Fetch the Steve HTTPS port from the DashboardServer. The port is
 * dynamic to avoid conflicts with other software on the default ports.
 */
const fetchStevePort = async(axios: any) => {
  try {
    const { data } = await axios.get('/api/steve-port');

    stevePort = `:${ data.port }`;
  } catch (error) {
    console.error('Failed to fetch Steve port:', error);
  }
};

/**
 * Intercepts requests to rewrite URLs. This is useful intercepting any direct
 * API calls when running dashboard with a proxy server.
 *
 * NOTE: This is currently used for running Dashboard in Rancher Desktop.
 * @param {*} axios The axios instance to modify
 */
const interceptApiRequest = (axios: any) => {
  axios.interceptors.request.use((config: any) => {
    // ensure that http traffic to properly route to the proxy server
    if (config.url.includes(':6120')) {
      config.url = config.url
        .replace('https://', 'http://');
    }

    if (stevePort && config.url.includes(stevePort)) {
      config.url = config.url
        .replace('https://', 'http://')
        .replace(stevePort, ':6120');
    }

    return config;
  }, (error: any) => {
    return Promise.reject(error);
  });
};

/**
 * Intercepts WebSocket URL construction to rewrite URLs for the proxy server.
 *
 * The dashboard runs on http://127.0.0.1:6120 (HTTP proxy) which proxies to
 * Steve's HTTPS port. WebSocket connections for pod logs/shell need to use
 * ws:// (not wss://) when going through the proxy.
 *
 * This fixes issue #3212 where newly created pods fail to show logs because
 * their WebSocket URLs use wss:// on the HTTP proxy port.
 */
const interceptWebSocketUrls = () => {
  const originalSetUrl = Socket.prototype.setUrl;

  Socket.prototype.setUrl = function(url: string) {
    // Let the original setUrl process the URL first (handles relative URLs,
    // protocol upgrades, etc.)
    originalSetUrl.call(this, url);

    // Now apply our transformations to this.url AFTER the original processing.
    // The original setUrl upgrades ws:// to wss:// when served over HTTPS,
    // so we need to fix it here.

    // Route WebSocket traffic through the HTTP proxy on port 6120
    // Convert wss://127.0.0.1:6120 → ws://127.0.0.1:6120
    if (this.url.includes(':6120')) {
      this.url = this.url.replace('wss://', 'ws://');
    }

    // Route direct API connections through the proxy
    // Convert wss://127.0.0.1:{stevePort} → ws://127.0.0.1:6120
    if (stevePort && this.url.includes(stevePort)) {
      this.url = this.url
        .replace('wss://', 'ws://')
        .replace(stevePort, ':6120');
    }
  };
};
