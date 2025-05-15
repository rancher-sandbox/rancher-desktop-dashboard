import { importTypes } from '@rancher/auto-import';
import { IInternal, IPlugin } from '@shell/core/types';

// Init the package
export default function(plugin: IPlugin, internal: IInternal): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  const { $axios, store, app: { router } } = internal;

  interceptApiRequest($axios);

  let logoRoute = router.resolve({
    name: 'c-cluster-explorer',
    params: { cluster: "local" },
  });

  store.commit('setIsSingleProduct', {
    productNameKey: 'rancher-desktop.label',
    logoRoute,
    logo: require(`./assets/logo.svg`),
  });
}

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
    if (config.url.includes(':6120') && config.url.includes('https')) {
      config.url = config.url
        .replace('https://', 'http://')
    }

    if (config.url.includes(':9443') && config.url.includes('https')) {
      config.url = config.url
        .replace('https://', 'http://')
        .replace(':9443', ':6120');
    }

    return config;
  }, (error: any) => {
    return Promise.reject(error);
  });
};
