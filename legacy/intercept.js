(function () {
    "use strict";

    const policy = globalThis.CourseraInterceptPolicy;
    if (!policy) {
        console.error("AutoCoursera interceptor policy was not loaded.");
        return;
    }

    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    function normalizeHeaders(headers) {
        if (!headers) return [];

        try {
            return Array.from(new Headers(headers).entries());
        } catch {
            return [];
        }
    }

    function getFetchRequestHeaders(resource, initParams) {
        const headers = new Headers(resource instanceof Request ? resource.headers : undefined);
        if (initParams?.headers) {
            new Headers(initParams.headers).forEach((value, name) => headers.set(name, value));
        }
        return normalizeHeaders(headers).filter(([name]) => (
            policy.CAPTURED_HEADER_NAMES.has(String(name || "").toLowerCase())
        ));
    }

    class InterceptBus {
        send(url, contentType, responseData, requestData) {
            const safeUrl = policy.normalizeCourseraApiUrl(url, window.location.href);
            if (!safeUrl) return;

            const safeHeaderNames = policy.observedRequestHeaderNames(requestData?.headers);
            const safeHeaders = policy.filterRequestHeaders(requestData?.headers);
            const safeResponse = policy.minimizeResponse(safeUrl, responseData);
            if (!policy.shouldEmit(safeUrl, safeHeaderNames, safeResponse)) return;

            window.postMessage({
                source: "auto-coursera-interceptor",
                url: safeUrl,
                contentType,
                response: safeResponse,
                request: {
                    url: safeUrl,
                    method: requestData?.method || "GET",
                    headerNames: safeHeaderNames,
                    headers: safeHeaders
                }
            }, window.location.origin);
        }
    }
    const messageBus = new InterceptBus();

    const MONACO_REQUEST_SOURCE = "auto-coursera-monaco-request";
    const MONACO_RESPONSE_SOURCE = "auto-coursera-monaco-response";

    function sendMonacoResponse(requestId, payload) {
        window.postMessage({
            source: MONACO_RESPONSE_SOURCE,
            requestId,
            ...payload
        }, window.location.origin);
    }

    async function findMonacoModel(modelUri) {
        const deadline = Date.now() + 2000;
        while (Date.now() < deadline) {
            const models = window.monaco?.editor?.getModels?.() || [];
            const model = models.find((candidate) => candidate.uri?.toString() === modelUri);
            if (model) return model;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    }

    window.addEventListener("message", async (event) => {
        if (
            event.source !== window ||
            event.origin !== window.location.origin ||
            event.data?.source !== MONACO_REQUEST_SOURCE
        ) return;

        const { requestId, action, modelUri, value, expectedValue } = event.data;
        if (typeof requestId !== "string" || !/^[a-z0-9-]{1,80}$/i.test(requestId)) return;
        if (!["read-model", "replace-model"].includes(action)) {
            sendMonacoResponse(requestId, { ok: false, error: "Unsupported Monaco action." });
            return;
        }
        if (typeof modelUri !== "string" || !modelUri.startsWith("inmemory://model/")) {
            sendMonacoResponse(requestId, { ok: false, error: "Invalid Monaco model URI." });
            return;
        }

        try {
            const model = await findMonacoModel(modelUri);
            if (!model) {
                sendMonacoResponse(requestId, { ok: false, error: "Coursera's code editor is not ready." });
                return;
            }

            if (action === "read-model") {
                sendMonacoResponse(requestId, { ok: true, value: model.getValue() });
                return;
            }

            if (typeof value !== "string" || typeof expectedValue !== "string") {
                sendMonacoResponse(requestId, { ok: false, error: "Invalid Monaco replacement payload." });
                return;
            }
            if (model.getValue() !== expectedValue) {
                sendMonacoResponse(requestId, {
                    ok: false,
                    error: "The code changed while the AI answer was being generated."
                });
                return;
            }

            model.pushStackElement?.();
            model.pushEditOperations(
                [],
                [{ range: model.getFullModelRange(), text: value, forceMoveMarkers: true }],
                () => null
            );
            model.pushStackElement?.();
            sendMonacoResponse(requestId, { ok: true });
        } catch {
            sendMonacoResponse(requestId, { ok: false, error: "Coursera's code editor could not be updated." });
        }
    });

    window.fetch = async function (resource, initParams) {
        const response = await originalFetch.apply(this, arguments);

        try {
            const requestUrl = response.url || (resource instanceof Request ? resource.url : String(resource || ""));
            const safeUrl = policy.normalizeCourseraApiUrl(requestUrl, window.location.href);
            if (!safeUrl) return response;

            const responseClone = response.clone();
            const contentType = responseClone.headers.get("content-type") || "";

            let responseBody;
            if (contentType.includes("application/json")) {
                try {
                    responseBody = await responseClone.json();
                } catch {
                    // Ignore malformed or streaming JSON copies; the original response remains untouched.
                }
            }

            messageBus.send(safeUrl, contentType, responseBody, {
                url: safeUrl,
                method: initParams?.method || (resource instanceof Request ? resource.method : "GET"),
                headers: getFetchRequestHeaders(resource, initParams)
            });
        } catch (error) {
            console.warn("AutoCoursera passive fetch inspection failed; returning the original response.", error);
        }

        return response;
    };

    XMLHttpRequest.prototype.open = function (method, url) {
        this._interceptUrl = url;
        this._interceptMethod = method;
        this._interceptHeaders = [];

        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
        const result = originalXHRSetRequestHeader.apply(this, arguments);
        const normalizedName = String(name).toLowerCase();
        if (!policy.CAPTURED_HEADER_NAMES.has(normalizedName)) return result;

        if (!Array.isArray(this._interceptHeaders)) {
            this._interceptHeaders = [];
        }

        const normalizedValue = String(value);
        const existingHeader = this._interceptHeaders.find(
            ([headerName]) => headerName === normalizedName
        );

        if (existingHeader) {
            existingHeader[1] = `${existingHeader[1]}, ${normalizedValue}`;
        } else {
            this._interceptHeaders.push([normalizedName, normalizedValue]);
        }

        return result;
    };

    XMLHttpRequest.prototype.send = function () {
        this.addEventListener("load", function () {
            try {
                const rawUrl = this.responseURL || this._interceptUrl;
                const safeUrl = policy.normalizeCourseraApiUrl(rawUrl, window.location.href);
                if (!safeUrl) return;

                const contentType = this.getResponseHeader("content-type") || "";
                let responseData;

                if (contentType.includes("application/json")) {
                    try {
                        responseData = JSON.parse(this.responseText);
                    } catch {
                        // Ignore response bodies that are not valid JSON.
                    }
                }

                messageBus.send(safeUrl, contentType, responseData, {
                    url: safeUrl,
                    method: this._interceptMethod,
                    headers: Array.isArray(this._interceptHeaders)
                        ? this._interceptHeaders.map(([name, value]) => [name, value])
                        : []
                });
            } catch (error) {
                console.warn("AutoCoursera passive XHR inspection failed.", error);
            }
        });

        return originalXHRSend.apply(this, arguments);
    };

    console.log("AutoCoursera interceptor attached with restricted capture policy.");
})();