import { installNetworkCapture } from '../../utils/shared/network-capture';

export default defineUnlistedScript(() => {
  installNetworkCapture('MENTORA_NETWORK_EVENT', '__mentoraNetworkInterceptorInstalled');
});
