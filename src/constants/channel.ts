import { BUILD_CHANNEL } from './buildChannel';

export const APP_CHANNEL: 'plus' | 'public' = BUILD_CHANNEL;

const channelName: string = APP_CHANNEL;

export const IS_PLUS_BUILD = channelName === 'plus';
