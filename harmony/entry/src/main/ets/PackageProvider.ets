import { RNPackage, TurboModulesFactory } from '@rnoh/react-native-openharmony';
import type { RNOHContext } from '@rnoh/react-native-openharmony';

export function createRNPackages(ctx: RNOHContext): RNPackage[] {
  return [];
}

// Used by Index.ets RNApp
export function getRNOHPackages(ctx: RNOHContext): RNPackage[] {
  return createRNPackages(ctx);
}
