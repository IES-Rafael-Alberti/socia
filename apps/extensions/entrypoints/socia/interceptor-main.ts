import { installNetworkCapture } from '../../utils/shared/network-capture';

export default defineUnlistedScript(() => {
  installNetworkCapture('SOCIA_NETWORK_EVENT', '__sociaNetworkInterceptorInstalled');
});
