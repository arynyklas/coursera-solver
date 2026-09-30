let capturedUserId = null;
let capturedCourseId = null;
let capturedAuthToken = null;
let capturedRequestHeaders = {};
let capturedCourseMaterials = null;
let latestCodeQuestionBindings = new Map();
let monacoRequestSequence = 0;

const capturedHeaderNames = new Set([
    "x-csrf2-cookie",
    "x-csrf2-token",
    "x-csrf3-token",
    "x-csrftoken",
    "x-requested-with"
]);

function normalizeInterceptedHeaders(headers) {
    if (Array.isArray(headers)) {
        return headers.filter((header) => Array.isArray(header) && header.length >= 2);
    }
    if (headers && typeof headers === "object") {
        return Object.entries(headers);
    }
    return [];
}

function captureRequestHeaders(headers) {
    normalizeInterceptedHeaders(headers).forEach(([name, value]) => {
        const normalizedName = String(name).toLowerCase();
        if (!capturedHeaderNames.has(normalizedName) || value == null) return;

        capturedRequestHeaders[normalizedName] = String(value);
        if (normalizedName === "x-csrf3-token") {
            capturedAuthToken = String(value);
        }
    });
}

// Listen for messages from the natively injected intercept script
window.addEventListener("message", (event) => {

    // We only accept messages from ourselves
    if (
        event.source !== window ||
        event.origin !== window.location.origin ||
        !event.data ||
        event.data.source !== "auto-coursera-interceptor"
    ) {
        return;
    }

    const { url, contentType, response, request } = event.data;

    // Capture the course materials directly from the intercepted response!
    if (request && request.url && request.url.includes("onDemandCourseMaterials.v2")) {
        if (response && response.linked && response.linked['onDemandCourseMaterialItems.v2']) {
            capturedCourseMaterials = response;
            console.log("Captured Course Materials natively via Interceptor!");
        }
    }

    if (response && response.context && response.context.dispatcher) {
        try {
            capturedUserId = response.context.dispatcher.stores.ApplicationStore.userData.id;
        } catch (e) { }
    }

    if (!capturedUserId && request && request.url) {
        const userMatch = request.url.match(/user\/([0-9]+)/) || request.url.match(/userId=([0-9]+)/);
        if (userMatch) {
            capturedUserId = userMatch[1];
            console.log("Got User ID from intercepted URL:", capturedUserId);
        }
    }

    if (request?.headers) {
        captureRequestHeaders(request.headers);
    }

    if (request && request.url && (request.url.includes("api/onDemandCourses.v1") || request.url.includes("slug="))) {
        const urlParams = new URL(request.url).searchParams;
        if (urlParams.has("slug")) {
            capturedCourseId = urlParams.get("slug");
            console.log("Got Course ID from API:", capturedCourseId);
        }
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fillDialogueAnswer") {
        fillCurrentDialogueAnswer()
            .then(() => sendResponse({ status: "filled" }))
            .catch((error) => sendResponse({ error: error.message || "Could not fill the dialogue answer." }));
        return true;
    }

    if (request.action === "solveQuizDirectly") {
        sendResponse({ status: "started" });
        solveCurrentAssessment();
        return true;
    }
    if (request.action === "applyAIResponse") {
        applyAnswersToDOM(request.data)
            .then((summary) => sendResponse({ data: summary }))
            .catch((error) => sendResponse({ error: error.message || "Could not apply the AI answers." }));
        return true;
    }
    if (request.action === "completeVideos") {
        if (!capturedCourseId) {
            const matchUrl = window.location.pathname.match(/\/learn\/([^/]+)/);
            if (matchUrl) {
                capturedCourseId = matchUrl[1];
                console.log("Got Course ID directly from URL Bar:", capturedCourseId);
            }
        }

        if (!capturedAuthToken) {
            sendResponse({ error: "Missing Auth Token! Please click around the course (e.g., refresh or open a new video) to grab background security tokens." });
            return true;
        }
        if (!capturedCourseId) {
            sendResponse({ error: "Missing Course ID! Please go to the main course page to grab your Course ID." });
            return true;
        }

        sendResponse({ status: "started" });
        startCompletionLoop();
        return true;
    }
    return false;
});

function readRuntime() {
    const runtime = globalThis.CourseraReadRuntime;
    if (!runtime) {
        throw new Error("Coursera read runtime is unavailable. Reload the page and try again.");
    }
    return runtime;
}

function assessmentQuestionBlocks() {
    return readRuntime().assessmentQuestionBlocks();
}

function codeEditorDescriptor(block) {
    return readRuntime().codeEditorDescriptor(block);
}

function requestMonacoBridge(action, payload = {}) {
    return new Promise((resolve, reject) => {
        const requestId = `monaco-${Date.now()}-${++monacoRequestSequence}`;
        const timeoutId = setTimeout(() => {
            window.removeEventListener("message", handleResponse);
            reject(new Error("Coursera's code editor did not respond."));
        }, 2600);

        function handleResponse(event) {
            if (
                event.source !== window ||
                event.origin !== window.location.origin ||
                event.data?.source !== "auto-coursera-monaco-response" ||
                event.data?.requestId !== requestId
            ) return;

            clearTimeout(timeoutId);
            window.removeEventListener("message", handleResponse);
            if (event.data.ok) resolve(event.data);
            else reject(new Error(event.data.error || "Coursera's code editor request failed."));
        }

        window.addEventListener("message", handleResponse);
        window.postMessage({
            source: "auto-coursera-monaco-request",
            requestId,
            action,
            ...payload
        }, window.location.origin);
    });
}

async function scrapeAssessmentDetailed() {
    return readRuntime().scrapeAssessmentDetailed();
}

function requestAIAssessmentAnswers(questions) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { action: "fetchAIExplanation", text: questions },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response?.error) {
                    reject(new Error(response.error));
                    return;
                }
                if (!Array.isArray(response?.result)) {
                    reject(new Error("The AI provider returned an unsupported answer."));
                    return;
                }
                resolve(response.result);
            }
        );
    });
}

function cleanCodeAnswer(value) {
    const code = String(value ?? "");
    const fenced = code.match(/^\s*```(?:[a-z0-9_+-]+)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i);
    return fenced ? fenced[1] : code;
}

async function applyAnswersToDOM(correctAnswers) {
    const questionBlocks = assessmentQuestionBlocks();
    const failures = [];
    let appliedCount = 0;

    for (let index = 0; index < questionBlocks.length; index += 1) {
        const block = questionBlocks[index];
        const questionNumber = index + 1;
        const answerData = Array.isArray(correctAnswers)
            ? correctAnswers.find((answer) => answer.questionNumber === questionNumber)
            : null;
        if (!answerData?.correctOptions?.length) continue;

        if (block.dataset.testid === "part-Submission_CodeExpressionQuestion") {
            const binding = latestCodeQuestionBindings.get(questionNumber);
            if (!binding) {
                failures.push({ questionNumber, error: "Code editor binding unavailable." });
                continue;
            }
            try {
                const replacement = cleanCodeAnswer(answerData.correctOptions[0]);
                if (!replacement.trim()) throw new Error("The AI returned empty code.");
                await requestMonacoBridge("replace-model", {
                    modelUri: binding.modelUri,
                    expectedValue: binding.expectedValue,
                    value: replacement
                });
                appliedCount += 1;
            } catch (error) {
                failures.push({ questionNumber, error: error.message || "Could not update the code editor." });
            }
            continue;
        }

        const optionNodes = Array.from(block.querySelectorAll('.rc-Option'));
        if (optionNodes.length > 0) {
            const availableAnswers = new Set();
            optionNodes.forEach((option) => {
                const textNode = option.querySelector('[data-testid="cml-viewer"]');
                const inputNode = option.querySelector('input[type="radio"], input[type="checkbox"]');
                if (!textNode || !inputNode) return;
                const optionText = textNode.innerText.trim();
                availableAnswers.add(optionText);
                const shouldBeSelected = answerData.correctOptions.includes(optionText);
                if (shouldBeSelected && !inputNode.checked) inputNode.click();
                else if (!shouldBeSelected && inputNode.checked && inputNode.type === "checkbox") inputNode.click();
            });

            if (answerData.correctOptions.every((answer) => availableAnswers.has(answer))) {
                appliedCount += 1;
            } else {
                failures.push({ questionNumber, error: "The selected option no longer matches the page." });
            }
            continue;
        }

        const textInputNode = block.querySelector(
            'input[type="text"], input:not([type="radio"]):not([type="checkbox"]), textarea:not(.inputarea), [data-slate-editor="true"]'
        );
        if (!textInputNode) {
            failures.push({ questionNumber, error: "No supported answer field was found." });
            continue;
        }

        const textToType = answerData.correctOptions[0];
        if (textInputNode.hasAttribute('contenteditable')) {
            textInputNode.focus();
            await new Promise((resolve) => setTimeout(resolve, 50));
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, textToType);
        } else {
            textInputNode.value = textToType;
            textInputNode.dispatchEvent(new Event('input', { bubbles: true }));
            textInputNode.dispatchEvent(new Event('change', { bubbles: true }));
        }
        appliedCount += 1;
    }

    return { appliedCount, failures };
}

async function solveCurrentAssessment() {
    showOrUpdateBanner("Extracting questions and contacting AI... 🤖", "info");
    try {
        const { questions, issues } = await scrapeAssessmentDetailed();
        if (questions.length === 0) {
            throw new Error("No supported questions were found on this page.");
        }

        const answers = await requestAIAssessmentAnswers(questions);
        const summary = await applyAnswersToDOM(answers);
        const failures = [...issues, ...summary.failures];

        if (failures.length === 0) {
            showOrUpdateBanner("Answers and code added successfully! ✅", "success");
            setTimeout(hideBanner, 4000);
            return;
        }

        const failedNumbers = [...new Set(failures.map((failure) => failure.questionNumber))]
            .sort((first, second) => first - second)
            .join(", ");
        showOrUpdateBanner(
            `Applied ${summary.appliedCount} answer${summary.appliedCount === 1 ? "" : "s"}. Check question${failedNumbers.includes(",") ? "s" : ""} ${failedNumbers}.`,
            "info"
        );
        setTimeout(hideBanner, 6500);
    } catch (error) {
        showOrUpdateBanner(`Error: ${error.message || "Could not solve this assessment."}`, "error");
        setTimeout(hideBanner, 5500);
    }
}

function extractDialogueState() {
    const root = document.querySelector('[data-testid="coursera-coach-item"], #coursera-coach-item');
    if (!root) {
        throw new Error("No Coursera dialogue was found on this page.");
    }

    const composer = root.querySelector(
        'textarea[aria-label="Send a message"]:not([aria-hidden="true"]):not([readonly])'
    );
    if (!composer || composer.disabled || composer.closest('[aria-disabled="true"]')) {
        throw new Error("Start the Coursera dialogue and wait for its question first.");
    }

    const coachMessageNodes = Array.from(root.querySelectorAll(
        '[data-testid="chat-message-llm"] [data-testid="coach-message-markdown"]'
    ));
    const currentQuestion = coachMessageNodes
        .map((node) => node.innerText.trim())
        .filter(Boolean)
        .at(-1);

    if (!currentQuestion) {
        throw new Error("No active Coursera dialogue question was found.");
    }

    const seenMessages = new Set();
    const messages = Array.from(root.querySelectorAll('[role="list"] > [role="listitem"]'))
        .map((item) => {
            const coachContent = item.querySelector(
                '[data-testid="chat-message-llm"] [data-testid="coach-message-markdown"]'
            );
            const role = coachContent ? "coach" : "learner";
            const text = coachContent ? coachContent.innerText.trim() : dialogueMessageText(item);
            return { role, text };
        })
        .filter((message) => {
            if (!message.text) return false;
            const fingerprint = `${message.role}:${message.text}`;
            if (seenMessages.has(fingerprint)) return false;
            seenMessages.add(fingerprint);
            return true;
        });

    return { composer, currentQuestion, messages };
}

function dialogueMessageText(item) {
    const copy = item.cloneNode(true);
    copy.querySelectorAll('button, [role="toolbar"], [role="status"], [aria-live]')
        .forEach((node) => node.remove());
    return copy.innerText.trim();
}

function requestDialogueAnswer(messages, currentQuestion) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            { action: "fetchDialogueAnswer", messages, currentQuestion },
            (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                if (response?.error) {
                    reject(new Error(response.error));
                    return;
                }
                if (!response?.result) {
                    reject(new Error("The AI provider did not return a dialogue answer."));
                    return;
                }
                resolve(response.result);
            }
        );
    });
}

function fillReactTextarea(textarea, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
    )?.set;

    if (valueSetter) {
        valueSetter.call(textarea, value);
    } else {
        textarea.value = value;
    }

    textarea.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: value
    }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(value.length, value.length);
}

async function fillCurrentDialogueAnswer() {
    const initialState = extractDialogueState();
    if (initialState.composer.value.trim()) {
        throw new Error("The dialogue message box already contains text. Clear it before generating an answer.");
    }

    const reply = await requestDialogueAnswer(initialState.messages, initialState.currentQuestion);
    const currentState = extractDialogueState();

    if (currentState.currentQuestion !== initialState.currentQuestion) {
        throw new Error("The Coursera dialogue changed while the answer was being generated. Try again.");
    }
    if (currentState.composer.value.trim()) {
        throw new Error("The dialogue message box changed while the answer was being generated.");
    }

    fillReactTextarea(currentState.composer, reply);
}

// Presentation helpers are isolated in presentation.js.
function presentationRuntime() {
    const presenter = globalThis.CourseraPresentation;
    if (!presenter || typeof presenter.show !== "function" || typeof presenter.hide !== "function") {
        throw new Error("Coursera presentation runtime is unavailable. Reload the page and try again.");
    }
    return presenter;
}

function showOrUpdateBanner(text, type = "info") {
    presentationRuntime().show(text, type);
}

function hideBanner() {
    presentationRuntime().hide();
}

async function startCompletionLoop() {
    console.log("Starting Auto-Completion for course: ", capturedCourseId);
    showOrUpdateBanner("Gathering course data...", "info");

    try {
        // STEP A: Fetch the course modules using the full includes string (now including contentSummary for exact types)
        const courseDataurl = `https://www.coursera.org/api/onDemandCourseMaterials.v2/?q=slug&slug=${capturedCourseId}&includes=modules,lessons,items&fields=moduleIds,onDemandCourseMaterialModules.v1(lessonIds,optional),onDemandCourseMaterialLessons.v1(elementIds,optional,itemIds),onDemandCourseMaterialItems.v2(name,isLocked,itemClass,contentSummary)`;
        const courseDataResponse = await fetch(courseDataurl, {
            headers: {
                "X-CSRF3-Token": capturedAuthToken
            }
        });

        const courseData = await courseDataResponse.json();
        // Extract the true internal course ID (e.g., 't_wxQwp9...') from the first element
        let internalCourseId = capturedCourseId;
        if (courseData && courseData.elements && courseData.elements.length > 0 && courseData.elements[0].id) {
            internalCourseId = courseData.elements[0].id;
            console.log("Found Internal Course ID: " + internalCourseId);
        }

        const itemsToComplete = extractVideoAndReadingIds(courseData);

        if (itemsToComplete.length === 0) {
            showOrUpdateBanner("Could not find any videos/modules to complete.", "error");
            alert("Could not find any videos/modules to complete. Did you load the correct page?");
            setTimeout(hideBanner, 4000);
            return;
        }

        console.log(`Found ${itemsToComplete.length} items to complete! Starting loop...`);

        // STEP B: Complete items in parallel chunks to dramatically speed up the process while avoiding rate limits!
        const CHUNK_SIZE = 6;
        console.log(`Found ${itemsToComplete.length} items to complete! Starting loop in chunks of ${CHUNK_SIZE}...`);

        for (let i = 0; i < itemsToComplete.length; i += CHUNK_SIZE) {
            const chunk = itemsToComplete.slice(i, i + CHUNK_SIZE);
            const chunkEnd = Math.min(i + CHUNK_SIZE, itemsToComplete.length);

            showOrUpdateBanner(`Completing items ${i + 1} to ${chunkEnd} of ${itemsToComplete.length}... ⚡`);

            const chunkPromises = chunk.map(async (itemObj, indexInChunk) => {
                const itemId = itemObj.id;
                const itemType = itemObj.type;
                const absIndex = i + indexInChunk + 1;

                console.log(`[${absIndex}/${itemsToComplete.length}] Faking completion for item: ${itemId} (Type: ${itemType})`);

                try {
                    const finalUserId = capturedUserId || "~";

                    if (itemType === 'lecture' || itemType === 'unknown') {
                        return fetch(`https://www.coursera.org/api/opencourse.v1/user/${finalUserId}/course/${capturedCourseId}/item/${itemId}/lecture/videoEvents/ended?autoEnroll=false`, {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "X-CSRF3-Token": capturedAuthToken },
                            body: JSON.stringify({ "contentRequestBody": {} })
                        });
                    } else if (itemType === 'supplement') {
                        if (internalCourseId) {
                            return fetch(`https://www.coursera.org/api/onDemandSupplementCompletions.v1`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json", "X-CSRF3-Token": capturedAuthToken },
                                body: JSON.stringify({ "userId": parseInt(finalUserId) || finalUserId, "courseId": internalCourseId, "itemId": itemId })
                            });
                        }
                    } else {
                        console.log(`[Skipping] Item ${itemId} has type '${itemType}' and does not need automation.`);
                    }
                } catch (e) {
                    console.log(`[Error] Request failed for item ${itemId}`, e);
                }
            });

            // Wait for all fetches in the current chunk to complete simultaneously
            await Promise.all(chunkPromises);

            // Tiny intentional delay between major chunks to preserve session health
            await new Promise(r => setTimeout(r, 400));
        }

        showOrUpdateBanner("Course Automagically Completed! Please refresh the page.", "success");
        alert("Course Automagically Completed! please refresh the page to see the changes.");
        setTimeout(hideBanner, 6000);
    } catch (err) {
        console.error(err);
        showOrUpdateBanner("An error occurred. Check browser console.", "error");
        alert("An error occurred. Check browser console.");
        setTimeout(hideBanner, 5000);
    }
}

// Helper: extracts the specific video/module ID's from Coursera's API response
function extractVideoAndReadingIds(jsonMap) {
    let ids = [];

    // When using 'includes=items', Coursera provides all items flatly in the 'linked' dictionary!
    if (jsonMap && jsonMap.linked && jsonMap.linked['onDemandCourseMaterialItems.v2']) {
        const items = jsonMap.linked['onDemandCourseMaterialItems.v2'];
        items.forEach(item => {
            // Extract the exact type using the newly added contentSummary, or fallback to itemClass
            const exactType = (item.contentSummary && item.contentSummary.typeName) ? item.contentSummary.typeName : (item.itemClass || 'unknown');

            // Determine if this item is an assignment/quiz/widget that we should NOT automate
            // Types directly from your provided JSON!
            const isQuizClass = ['quiz', 'exam', 'programming', 'phasedPeer', 'peer', 'ungradedAssignment', 'staffGraded', 'ungradedWidget'].includes(exactType);

            // Fallback to name checking just in case
            const isQuizName = item.name && (item.name.toLowerCase().includes('quiz') || item.name.toLowerCase().includes('challenge'));

            if (item && item.id && !isQuizClass && !isQuizName) {
                // Push BOTH the ID and the exact Type so the completion loop knows what to do!
                ids.push({ id: item.id, type: exactType });
            } else if (item && item.id) {
                console.log(`[Filtered out assignment/quiz]: ${item.name} (${exactType})`);
            }
        });
        return ids;
    }

    // Fallback for older V1 formats just in case
    if (jsonMap && jsonMap.elements && jsonMap.elements[0] && jsonMap.elements[0].modules) {
        jsonMap.elements[0].modules.forEach(module => {
            if (module.lessons) {
                module.lessons.forEach(lesson => {
                    if (lesson.itemIds) {
                        lesson.itemIds.forEach(itemId => ids.push({ id: itemId, type: 'unknown' }));
                    }
                });
            }
        });
    }

    return ids;
}
