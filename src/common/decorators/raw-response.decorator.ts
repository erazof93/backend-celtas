import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE = 'celtas.raw-response';
/** Only explicit streaming endpoints bypass the REST envelope. */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);
