#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <objc/runtime.h>

using StreamInitializer = id (*)(
    id,
    SEL,
    SCContentFilter *,
    SCStreamConfiguration *,
    id<SCStreamDelegate>);
using WindowFilterInitializer = id (*)(id, SEL, SCWindow *);

static StreamInitializer originalStreamInitializer = nullptr;
static WindowFilterInitializer originalWindowFilterInitializer = nullptr;
static const void *windowFilterMarker = &windowFilterMarker;

static id initializeWindowFilter(id receiver, SEL selector, SCWindow *window) {
    id filter = originalWindowFilterInitializer(receiver, selector, window);
    if (filter != nil) {
        objc_setAssociatedObject(
            filter,
            windowFilterMarker,
            @YES,
            OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    return filter;
}

static bool isWindowFilter(SCContentFilter *filter) {
    if ([objc_getAssociatedObject(filter, windowFilterMarker) boolValue]) return true;
    if (@available(macOS 14.0, *)) {
        return filter.style == SCShareableContentStyleWindow;
    }
    return false;
}

static id initializeStreamWithoutWindowCursor(
    id receiver,
    SEL selector,
    SCContentFilter *filter,
    SCStreamConfiguration *configuration,
    id<SCStreamDelegate> delegate) {
    if (isWindowFilter(filter)) {
        configuration.showsCursor = NO;
    }
    return originalStreamInitializer(receiver, selector, filter, configuration, delegate);
}

static bool installWindowCursorPolicy() {
    static bool installed = false;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        Class filterClass = NSClassFromString(@"SCContentFilter");
        SEL filterSelector = @selector(initWithDesktopIndependentWindow:);
        Method filterInitializer = class_getInstanceMethod(filterClass, filterSelector);
        if (filterInitializer != nullptr &&
            method_getNumberOfArguments(filterInitializer) == 3 &&
            method_getTypeEncoding(filterInitializer) != nullptr) {
            originalWindowFilterInitializer = reinterpret_cast<WindowFilterInitializer>(
                method_getImplementation(filterInitializer));
            method_setImplementation(
                filterInitializer,
                reinterpret_cast<IMP>(initializeWindowFilter));
        }

        Class streamClass = NSClassFromString(@"SCStream");
        SEL selector = @selector(initWithFilter:configuration:delegate:);
        Method initializer = class_getInstanceMethod(streamClass, selector);
        if (initializer == nullptr ||
            method_getNumberOfArguments(initializer) != 5 ||
            method_getTypeEncoding(initializer) == nullptr) return;
        if (@available(macOS 14.0, *)) {
            // SCContentFilter.style identifies window filters directly.
        } else if (originalWindowFilterInitializer == nullptr) {
            return;
        }

        originalStreamInitializer = reinterpret_cast<StreamInitializer>(
            method_getImplementation(initializer));
        method_setImplementation(
            initializer,
            reinterpret_cast<IMP>(initializeStreamWithoutWindowCursor));
        installed = true;
    });
    return installed;
}

using NapiEnvironment = void *;
using NapiValue = void *;
using NapiStatus = int;

extern "C" NapiStatus napi_get_boolean(NapiEnvironment, bool, NapiValue *);
extern "C" NapiStatus napi_set_named_property(
    NapiEnvironment,
    NapiValue,
    const char *,
    NapiValue);

extern "C" __attribute__((visibility("default"))) NapiValue napi_register_module_v1(
    NapiEnvironment environment,
    NapiValue exports) {
    NapiValue installedValue = nullptr;
    if (napi_get_boolean(environment, installWindowCursorPolicy(), &installedValue) != 0) {
        return nullptr;
    }
    if (napi_set_named_property(environment, exports, "installed", installedValue) != 0) {
        return nullptr;
    }
    return exports;
}
