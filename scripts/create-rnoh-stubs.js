const fs = require('fs');
const path = require('path');

// Base directory of the RNOH package
const RNOH_ROOT = path.resolve(__dirname, '..', 'node_modules', '@react-native-oh', 'react-native-harmony');

// Common stubs for native modules that RNOH expects but don't exist in this RN version
const STUBS = {
  'Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent.js':
    `module.exports = () => {};`,

  'Libraries/Network/RCTNetworking.js':
    `const RCTNetworking = { sendRequest: () => {}, abortRequest: () => {}, clearCookies: () => {} };
exports.default = RCTNetworking;`,

  'Libraries/Blob/BlobManager.js':
    `const BlobManager = { addNetworkingHandler: () => {}, removeNetworkingHandler: () => {}, sendOverSocket: () => {} };
module.exports = BlobManager;`,

  'Libraries/Utilities/GlobalPerformanceLogger.js':
    `const GlobalPerformanceLogger = { startTimespan: () => {}, stopTimespan: () => {}, logTimespan: () => {} };
module.exports = GlobalPerformanceLogger;`,

  'Libraries/EventEmitter/NativeEventEmitter.js':
    `const EventEmitter = require('eventemitter3');
class NativeEventEmitter extends EventEmitter {}
module.exports = NativeEventEmitter;`,

  'Libraries/BatchedBridge/NativeModules.js':
    `const NativeModules = {};
module.exports = NativeModules;`,

  'Libraries/BatchedBridge/MessageQueue.js':
    `const MessageQueue = { spy: () => {} };
module.exports = MessageQueue;`,

  'Libraries/ReactNative/NativeUIManager.js':
    `const NativeUIManager = {};
module.exports = NativeUIManager;`,

  'Libraries/ReactNative/AppRegistry.js':
    `const AppRegistry = { registerComponent: () => {}, registerRunnable: () => {}, runApplication: () => {} };
module.exports = AppRegistry;`,

  'Libraries/vendor/emitter/EventEmitter.js':
    `const EventEmitter = require('eventemitter3');
module.exports = EventEmitter;`,

  'Libraries/Network/convertRequestBody.js':
    `function convertRequestBody(body) { return body; }
module.exports = convertRequestBody;`,

  'Libraries/Utilities/Platform.ios.js':
    `const Platform = { OS: 'ios', Version: '18.0', isTesting: false, constants: {} };
module.exports = Platform;`,

  'Libraries/StyleSheet/PlatformColorValueTypes.ios.js':
    `module.exports = {};`,

  'Libraries/StyleSheet/StyleSheet.js':
    `const StyleSheet = { create: (s) => s, flatten: (s) => s, hairlineWidth: 1 };
module.exports = StyleSheet;`,

  'Libraries/Image/Image.js':
    `const React = require('react');
const Image = (props) => null;
module.exports = Image;`,

  'Libraries/Text/Text.js':
    `const React = require('react');
const Text = (props) => null;
module.exports = Text;`,

  'Libraries/Components/View/View.js':
    `const React = require('react');
const View = (props) => null;
module.exports = View;`,

  'Libraries/Components/ScrollView/ScrollView.js':
    `const React = require('react');
const ScrollView = (props) => null;
module.exports = ScrollView;`,

  'Libraries/Components/Touchable/TouchableOpacity.js':
    `const React = require('react');
const TouchableOpacity = (props) => null;
module.exports = TouchableOpacity;`,

  'Libraries/Components/Touchable/TouchableWithoutFeedback.js':
    `const React = require('react');
const TouchableWithoutFeedback = (props) => null;
module.exports = TouchableWithoutFeedback;`,

  'Libraries/Components/ActivityIndicator/ActivityIndicator.js':
    `const React = require('react');
const ActivityIndicator = (props) => null;
module.exports = ActivityIndicator;`,

  'Libraries/Components/TextInput/TextInput.js':
    `const React = require('react');
const TextInput = (props) => null;
module.exports = TextInput;`,

  'Libraries/Modal/Modal.js':
    `const React = require('react');
const Modal = (props) => null;
module.exports = Modal;`,

  'Libraries/Animated/Animated.js':
    `const Animated = { View: null, Text: null, Image: null, ScrollView: null, createAnimatedComponent: (c) => c };
module.exports = Animated;`,

  'Libraries/ReactNative/requireNativeComponent.js':
    `function requireNativeComponent(name) { return null; }
module.exports = requireNativeComponent;`,

  'Libraries/Utilities/differ/deepDiffer.js':
    `function deepDiffer(a, b) { return a !== b; }
module.exports = deepDiffer;`,

  'Libraries/Utilities/differ/insetsDiffer.js':
    `function insetsDiffer(a, b) { return false; }
module.exports = insetsDiffer;`,

  'Libraries/Utilities/differ/matricesDiffer.js':
    `function matricesDiffer(a, b) { return false; }
module.exports = matricesDiffer;`,

  'Libraries/Utilities/differ/pointsDiffer.js':
    `function pointsDiffer(a, b) { return false; }
module.exports = pointsDiffer;`,

  'Libraries/Utilities/differ/sizesDiffer.js':
    `function sizesDiffer(a, b) { return false; }
module.exports = sizesDiffer;`,

  'Libraries/ReactNative/RendererProxy.js':
    `module.exports = {};`,

  'Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js':
    `const ReactNativeViewConfigRegistry = { register: () => {}, get: () => ({}) };
module.exports = ReactNativeViewConfigRegistry;`,

  'Libraries/Renderer/shims/ReactFabric.js':
    `module.exports = {};`,

  'Libraries/ReactPrivate/ReactNativePrivateInterface.js':
    `module.exports = {};`,

  'Libraries/ReactPrivate/ReactNativePrivateInitializeCore.js':
    `module.exports = {};`,

  'Libraries/Core/InitializeCore.js':
    `module.exports = {};`,

  'Libraries/Core/setUpRegeneratorRuntime.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpXHR.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpAlert.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpNavigation.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpTimers.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpSystrace.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpErrorHandling.js':
    `module.exports = () => {};`,

  'Libraries/Core/setUpDeveloperTools.js':
    `module.exports = () => {};`,

  'Libraries/Core/Devtools/getDevServer.js':
    `function getDevServer() { return { url: '', bundleLoadedFromServer: false }; }
module.exports = getDevServer;`,

  'Libraries/Core/Devtools/parseErrorStack.js':
    `function parseErrorStack(e) { return []; }
module.exports = parseErrorStack;`,

  'Libraries/Core/Devtools/symbolicateStackTrace.js':
    `function symbolicateStackTrace(stack) { return stack; }
module.exports = symbolicateStackTrace;`,

  'Libraries/Core/ExceptionsManager.js':
    `const ExceptionsManager = { handleException: () => {}, installConsoleErrorReporter: () => {} };
module.exports = ExceptionsManager;`,

  'Libraries/Utilities/HMRClient.js':
    `const HMRClient = { setup: () => {}, enable: () => {}, disable: () => {} };
module.exports = HMRClient;`,

  'Libraries/Utilities/DevLoadingView.js':
    `const DevLoadingView = { showMessage: () => {} };
module.exports = DevLoadingView;`,

  'Libraries/Utilities/RCTLog.js':
    `const RCTLog = { logIfNoNativeHook: () => {} };
module.exports = RCTLog;`,

  'Libraries/Utilities/useWindowDimensions.js':
    `const { useState, useEffect } = require('react');
function useWindowDimensions() { return { width: 375, height: 812 }; }
module.exports = useWindowDimensions;`,

  'Libraries/Utilities/Dimensions.js':
    `const Dimensions = { get: () => ({ width: 375, height: 812 }), addEventListener: () => {}, removeEventListener: () => {} };
module.exports = Dimensions;`,

  'Libraries/Utilities/PixelRatio.js':
    `const PixelRatio = { get: () => 2, getFontScale: () => 1, getPixelSizeForLayoutSize: (s) => s };
module.exports = PixelRatio;`,

  'Libraries/Utilities/Appearance.js':
    `const Appearance = { getColorScheme: () => 'light', addChangeListener: () => {} };
module.exports = Appearance;`,

  'Libraries/Utilities/BackHandler.ios.js':
    `const BackHandler = { addEventListener: () => {}, removeEventListener: () => {} };
module.exports = BackHandler;`,

  'Libraries/WebSocket/WebSocket.js':
    `const { default: OriginalWebSocket } = require('ws');
module.exports = OriginalWebSocket;`,

  'Libraries/Interaction/TaskQueue.js':
    `const TaskQueue = { enqueue: (cb) => cb() };
module.exports = TaskQueue;`,

  'Libraries/Interaction/InteractionManager.js':
    `const InteractionManager = { runAfterInteractions: (cb) => Promise.resolve(cb()) };
module.exports = InteractionManager;`,

  'Libraries/Performance/Systrace.js':
    `const Systrace = { installReactHook: () => {}, beginEvent: () => {}, endEvent: () => {} };
module.exports = Systrace;`,

  'Libraries/LogBox/LogBox.js':
    `const LogBox = { ignoreAllLogs: () => {}, install: () => {} };
module.exports = LogBox;`,

  'Libraries/LogBox/LogBoxInspectorContainer.js':
    `module.exports = null;`,

  'Libraries/LogBox/Data/LogBoxData.js':
    `module.exports = { addLog: () => {} };`,

  'Libraries/LogBox/UI/LogBoxInspector.js':
    `module.exports = null;`,

  'Libraries/NewAppScreen/NewAppScreen.js':
    `module.exports = null;`,

  'Libraries/Components/StatusBar/StatusBar.js':
    `const React = require('react');
const StatusBar = (props) => null;
module.exports = StatusBar;`,

  'Libraries/Components/SafeAreaView/SafeAreaView.js':
    `const React = require('react');
const SafeAreaView = (props) => null;
module.exports = SafeAreaView;`,

  'Libraries/Components/Keyboard/Keyboard.js':
    `const Keyboard = { addListener: () => {}, removeListener: () => {} };
module.exports = Keyboard;`,

  'Libraries/Components/Keyboard/KeyboardAvoidingView.js':
    `const React = require('react');
const KeyboardAvoidingView = (props) => null;
module.exports = KeyboardAvoidingView;`,

  'Libraries/Components/Clipboard/NativeClipboard.js':
    `const NativeClipboard = { getString: () => Promise.resolve(''), setString: () => {} };
module.exports = NativeClipboard;`,

  'Libraries/Components/AccessibilityInfo/AccessibilityInfo.js':
    `const AccessibilityInfo = { isScreenReaderEnabled: () => Promise.resolve(false) };
module.exports = AccessibilityInfo;`,

  'Libraries/Components/AccessibilityInfo/NativeAccessibilityManager.js':
    `module.exports = {};`,

  'Libraries/Components/AccessibilityInfo/NativeAccessibilityManagerIOS.js':
    `module.exports = {};`,

  'Libraries/Components/RefreshControl/RefreshControl.js':
    `const React = require('react');
const RefreshControl = (props) => null;
module.exports = RefreshControl;`,

  'Libraries/Components/Button.js':
    `const React = require('react');
const Button = (props) => null;
module.exports = Button;`,

  'Libraries/Components/Switch/Switch.js':
    `const React = require('react');
const Switch = (props) => null;
module.exports = Switch;`,

  'Libraries/Components/UnimplementedViews/UnimplementedView.js':
    `const React = require('react');
const UnimplementedView = (props) => null;
module.exports = UnimplementedView;`,

  'Libraries/Components/ProgressBarAndroid/ProgressBarAndroid.js':
    `const React = require('react');
const ProgressBarAndroid = (props) => null;
module.exports = ProgressBarAndroid;`,

  'Libraries/Components/ToastAndroid/ToastAndroid.js':
    `const ToastAndroid = { show: () => {}, showWithGravity: () => {} };
module.exports = ToastAndroid;`,

  'Libraries/Components/DrawerAndroid/DrawerLayoutAndroid.js':
    `const React = require('react');
const DrawerLayoutAndroid = (props) => null;
module.exports = DrawerLayoutAndroid;`,

  'Libraries/Components/ProgressViewIOS/ProgressViewIOS.js':
    `const React = require('react');
const ProgressViewIOS = (props) => null;
module.exports = ProgressViewIOS;`,

  'Libraries/Components/DatePicker/DatePickerIOS.js':
    `const React = require('react');
const DatePickerIOS = (props) => null;
module.exports = DatePickerIOS;`,

  'Libraries/Components/Picker/Picker.js':
    `const React = require('react');
const Picker = (props) => null;
module.exports = Picker;`,

  'Libraries/Components/Slider/Slider.js':
    `const React = require('react');
const Slider = (props) => null;
module.exports = Slider;`,

  'Libraries/Components/DatePickerAndroid/DatePickerAndroid.js':
    `const DatePickerAndroid = { open: () => Promise.resolve({ action: 'dismissedAction' }) };
module.exports = DatePickerAndroid;`,

  'Libraries/Components/TimePickerAndroid/TimePickerAndroid.js':
    `const TimePickerAndroid = { open: () => Promise.resolve({ action: 'dismissedAction' }) };
module.exports = TimePickerAndroid;`,

  'Libraries/Components/StatusBar/NativeStatusBarManager.js':
    `module.exports = {};`,

  'Libraries/Image/Image.ios.js':
    `module.exports = require('./Image');`,

  'Libraries/Image/AssetRegistry.js':
    `const assets = [];
module.exports = { registerAsset: (a) => assets.push(a) && assets.length - 1, getAssetByID: (id) => assets[id] };`,

  'Libraries/Image/AssetSourceResolver.js':
    `class AssetSourceResolver { defaultAsset() { return { uri: '' }; } }
module.exports = AssetSourceResolver;`,

  'Libraries/Image/NativeImageLoaderIOS.js':
    `module.exports = {};`,

  'Libraries/Image/NativeImageEditor.js':
    `module.exports = {};`,

  'Libraries/Image/NativeImageStoreIOS.js':
    `module.exports = {};`,

  'Libraries/Image/NativeImagePickerIOS.js':
    `module.exports = {};`,

  'Libraries/Utilities/NativePlatformConstantsIOS.js':
    `module.exports = { getConstants: () => ({ isTesting: false, reactNativeVersion: { major: 0, minor: 81 } }) };`,

  'Libraries/Utilities/NativeDevSettings.js':
    `module.exports = {};`,

  'Libraries/Storage/NativeAsyncStorage.js':
    `const AsyncStorage = { multiGet: () => Promise.resolve([]), multiSet: () => {}, multiRemove: () => {} };
module.exports = AsyncStorage;`,

  'Libraries/Storage/NativeAsyncLocalStorage.js':
    `module.exports = require('./NativeAsyncStorage');`,

  'Libraries/Network/NativeNetworkingIOS.js':
    `module.exports = {};`,

  'Libraries/Network/RCTNetworking.ios.js':
    `exports.default = {};`,

  'Libraries/PushNotificationIOS/NativePushNotificationManagerIOS.js':
    `module.exports = {};`,

  'Libraries/Alert/NativeAlertManager.js':
    `module.exports = {};`,

  'Libraries/ActionSheetIOS/NativeActionSheetManager.js':
    `module.exports = {};`,

  'Libraries/Share/NativeShareModule.js':
    `module.exports = {};`,

  'Libraries/Vibration/NativeVibration.js':
    `module.exports = {};`,

  'Libraries/Settings/NativeSettingsManager.js':
    `module.exports = {};`,

  'Libraries/CameraRoll/NativeCameraRollManager.js':
    `module.exports = {};`,

  'Libraries/AppState/NativeAppState.js':
    `module.exports = { getConstants: () => ({ initialAppState: 'active' }) };`,

  'Libraries/BugReporting/NativeBugReporting.js':
    `module.exports = {};`,

  'Libraries/HeapCapture/NativeJSCHeapCapture.js':
    `module.exports = {};`,

  'Libraries/Animated/NativeAnimatedHelper.js':
    `module.exports = { API: { createAnimatedNode: () => {} } };`,

  'Libraries/Animated/NativeAnimatedModule.js':
    `module.exports = {};`,

  'Libraries/Animated/NativeAnimatedTurboModule.js':
    `module.exports = {};`,

  'Libraries/Animated/animations/Animation.js':
    `class Animation { start() {} stop() {} }
module.exports = Animation;`,

  'Libraries/Animated/animations/DecayAnimation.js':
    `module.exports = require('./Animation');`,

  'Libraries/Animated/animations/SpringAnimation.js':
    `module.exports = require('./Animation');`,

  'Libraries/Animated/animations/TimingAnimation.js':
    `module.exports = require('./Animation');`,

  'Libraries/Animated/nodes/AnimatedNode.js':
    `class AnimatedNode {}
module.exports = AnimatedNode;`,

  'Libraries/Animated/nodes/AnimatedValue.js':
    `module.exports = require('./AnimatedNode');`,

  'Libraries/Animated/nodes/AnimatedWithChildren.js':
    `module.exports = require('./AnimatedNode');`,

  'Libraries/Animated/nodes/AnimatedInterpolation.js':
    `module.exports = require('./AnimatedNode');`,

  'Libraries/Animated/nodes/AnimatedProps.js':
    `module.exports = require('./AnimatedNode');`,

  'Libraries/Animated/nodes/AnimatedStyle.js':
    `module.exports = require('./AnimatedNode');`,

  'Libraries/Animated/nodes/AnimatedTransform.js':
    `module.exports = require('./AnimatedNode');`,

  'Libraries/Animated/components/AnimatedImage.js':
    `module.exports = { default: null };`,

  'Libraries/Animated/components/AnimatedScrollView.js':
    `module.exports = { default: null };`,

  'Libraries/Animated/components/AnimatedSectionList.js':
    `module.exports = { default: null };`,

  'Libraries/Animated/components/AnimatedFlatList.js':
    `module.exports = { default: null };`,

  'Libraries/Animated/components/AnimatedText.js':
    `module.exports = { default: null };`,

  'Libraries/Animated/components/AnimatedView.js':
    `module.exports = { default: null };`,

  'Libraries/Animated/Easing.js':
    `const Easing = { linear: (t) => t, ease: (t) => t, inOut: (e) => (t) => t };
module.exports = Easing;`,

  'Libraries/Types/CoreEventTypes.js':
    `module.exports = {};`,

  'Libraries/Utilities/DeviceInfo.js':
    `module.exports = {};`,

  'Libraries/ReactNative/I18nManager.js':
    `const I18nManager = { isRTL: false, allowRTL: () => {}, forceRTL: () => {} };
module.exports = I18nManager;`,

  'Libraries/ReactNative/NativeI18nManager.js':
    `module.exports = { getConstants: () => ({ isRTL: false }) };`,

  'Libraries/ReactNative/UIManager.js':
    `const UIManager = { getViewManagerConfig: () => ({}), takeSnapshot: () => Promise.resolve('') };
module.exports = UIManager;`,

  'Libraries/ReactNative/UIManagerProperties.js':
    `module.exports = {};`,

  'Libraries/ReactNative/PaperUIManager.js':
    `module.exports = {};`,

  'Libraries/ReactNative/FabricUIManager.js':
    `module.exports = {};`,

  'Libraries/TurboModule/TurboModuleRegistry.js':
    `function get(name) { return {}; }
module.exports = { get };`,

  'Libraries/TurboModule/RCTExport.js':
    `module.exports = {};`,

  'Libraries/NativeComponent/NativeComponentRegistry.js':
    `function get(name, viewConfigProvider) { return null; }
module.exports = { get };`,

  'Libraries/ReactNative/HeadlessJsTaskError.js':
    `class HeadlessJsTaskError extends Error {}
module.exports = HeadlessJsTaskError;`,

  'Libraries/Utilitites/useMergeRefs.js':
    `function useMergeRefs() {}
module.exports = useMergeRefs;`,

  'Libraries/Utilitites/useRefEffect.js':
    `function useRefEffect() {}
module.exports = useRefEffect;`,

  'Libraries/Components/View/ViewAccessibility.js':
    `module.exports = {};`,

  'Libraries/Pressability/Pressability.js':
    `class Pressability { constructor() {} }
module.exports = Pressability;`,

  'Libraries/Pressability/HoverState.js':
    `module.exports = {};`,

  'Libraries/Components/TextInput/InputAccessoryView.js':
    `const React = require('react');
const InputAccessoryView = (props) => null;
module.exports = InputAccessoryView;`,

  'Libraries/Components/TextInput/RCTInput.js':
    `module.exports = {};`,

  'Libraries/Components/TextInput/RCTMultilineTextInputView.js':
    `module.exports = {};`,

  'Libraries/Components/TextInput/RCTSinglelineTextInputView.js':
    `module.exports = {};`,

  'Libraries/Utilities/PerformanceLoggerContext.js':
    `module.exports = { Provider: (p) => null };`,

  'Libraries/Blob/FileReader.js':
    `class FileReader extends require('events').EventEmitter { readAsArrayBuffer() {} readAsText() {} }
module.exports = FileReader;`,

  'Libraries/Blob/Blob.js':
    `class Blob {}
module.exports = Blob;`,

  'Libraries/Blob/File.js':
    `module.exports = require('./Blob');`,

  'Libraries/Blob/URL.js':
    `const URL = { createObjectURL: () => '' };
module.exports = URL;`,

  'Libraries/Network/FormData.js':
    `class FormData { append() {} }
module.exports = FormData;`,

  'Libraries/Utilities/binaryToBase64.js':
    `function binaryToBase64(b) { return b; }
module.exports = binaryToBase64;`,

  'Libraries/Utilities/defineLazyObjectProperty.js':
    `function defineLazyObjectProperty(obj, name, getter) { Object.defineProperty(obj, name, { get: getter }); }
module.exports = defineLazyObjectProperty;`,

  'Libraries/Utilities/infoLog.js':
    `function infoLog(...args) {}
module.exports = infoLog;`,

  'Libraries/Utilities/warnOnce.js':
    `const warned = new Set();
function warnOnce(condition, ...args) {}
module.exports = warnOnce;`,

  'Libraries/ReactNative/getCachedComponentName.js':
    `function getCachedComponentName() { return 'Component'; }
module.exports = getCachedComponentName;`,

  'Libraries/ReactNative/ReactFabricInternals.js':
    `module.exports = {};`,

  'Libraries/Settings/Settings.js':
    `const Settings = { get: () => ({}), set: () => {}, watchKeys: () => {} };
module.exports = Settings;`,

  'Libraries/HeapCapture/HeapCapture.js':
    `module.exports = { captureHeap: () => '' };`,

  'Libraries/Performance/QuickPerformanceLogger.js':
    `module.exports = { markerStart: () => {}, markerEnd: () => {} };`,

  'Libraries/Utilities/NativeJSDevSupport.js':
    `module.exports = {};`,

  'Libraries/Utilities/SceneTracker.js':
    `module.exports = { activeScene: null };`,

  'Libraries/ReactNative/AppContainer.js':
    `module.exports = null;`,

  'Libraries/ReactNative/RootTag.js':
    `let tag = 1;
module.exports = { createRootTag: () => tag++, isRootTag: () => true };`,

  'Libraries/Components/View/ReactNativeStyleAttributes.js':
    `module.exports = {};`,

  'Libraries/Components/View/ReactNativeViewAttributes.js':
    `module.exports = {};`,

  'Libraries/Components/ScrollView/ScrollViewNativeComponent.js':
    `module.exports = null;`,

  'Libraries/Components/ScrollView/processDecelerationRate.js':
    `function processDecelerationRate(r) { return r; }
module.exports = processDecelerationRate;`,

  'Libraries/StyleSheet/processColor.js':
    `function processColor(c) { return c; }
module.exports = processColor;`,

  'Libraries/StyleSheet/processTransform.js':
    `function processTransform(t) { return t; }
module.exports = processTransform;`,

  'Libraries/StyleSheet/normalizeColor.js':
    `function normalizeColor(c) { return c; }
module.exports = normalizeColor;`,

  'Libraries/StyleSheet/splitLayoutProps.js':
    `function splitLayoutProps(p) { return { outer: p, inner: {} }; }
module.exports = splitLayoutProps;`,

  'Libraries/Utilities/NativeRenderHTML.js':
    `module.exports = {};`,

  'Libraries/Utilities/createPerformanceLogger.js':
    `function createPerformanceLogger() { return { addTimespan: () => {}, startTimespan: () => {}, stopTimespan: () => {} }; }
module.exports = createPerformanceLogger;`,

  'Libraries/Components/ScrollView/ScrollViewStickyHeader.js':
    `const React = require('react');
const ScrollViewStickyHeader = (props) => null;
module.exports = ScrollViewStickyHeader;`,

  'Libraries/Components/DynamicColorIOS/DynamicColorIOS.js':
    `function DynamicColorIOS(c) { return c; }
module.exports = DynamicColorIOS;`,

  'Libraries/Pressability/usePressability.js':
    `function usePressability() { return {}; }
module.exports = usePressability;`,

  'Libraries/Components/View/ViewPropTypes.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedViewAccessibility.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedTextAccessibility.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedImageStylePropTypes.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedTextInputPropTypes.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedColorPropType.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedEdgeInsetsPropType.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedPointPropType.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedLayoutPropTypes.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedShadowPropTypesIOS.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedTransformPropTypes.js':
    `module.exports = {};`,

  'Libraries/DeprecatedPropTypes/DeprecatedStyleSheetPropType.js':
    `module.exports = {};`,

  'Libraries/Utilities/FontManager.js':
    `module.exports = {};`,

  'Libraries/Components/StatusBar/StatusBarIOS.js':
    `module.exports = null;`,

  'Libraries/Utilities/DebugEnvironment.js':
    `module.exports = { isAsyncDebugging: false };`,

  'Libraries/YellowBox/YellowBoxDeprecated.js':
    `module.exports = { ignoreWarnings: () => {} };`,

  'Libraries/ReactNative/BridgelessUIManager.js':
    `module.exports = {};`,
};

let created = 0;
let existed = 0;

for (const [relPath, content] of Object.entries(STUBS)) {
  const fullPath = path.join(RNOH_ROOT, relPath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, content, 'utf8');
    created++;
  } else {
    existed++;
  }
}

console.log(`RNOH stubs: ${created} created, ${existed} already existed (out of ${Object.keys(STUBS).length} total)`);
