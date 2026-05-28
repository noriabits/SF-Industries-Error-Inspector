(function () {
  "use strict";

  const errorListEl = document.getElementById("errorList");
  const emptyStateEl = document.getElementById("emptyState");
  const errorCountEl = document.getElementById("errorCount");
  const clearBtn = document.getElementById("clearBtn");
  const autoScrollCheckbox = document.getElementById("autoScroll");
  const showAllCheckbox = document.getElementById("showAllRequests");

  let errorCount = 0;
  let entries = [];

  // --- Utility: Parse URL-encoded body into structured data ---
  function parseAuraBody(bodyText) {
    try {
      const params = new URLSearchParams(bodyText);
      const messageStr = params.get("message");
      if (!messageStr) return null;
      return JSON.parse(messageStr);
    } catch (e) {
      return null;
    }
  }

  // --- Utility: Recursively decode nested JSON strings ---
  function deepDecodeJson(value) {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return deepDecodeJson(parsed);
      } catch (e) {
        return value;
      }
    }
    if (Array.isArray(value)) {
      return value.map(deepDecodeJson);
    }
    if (value && typeof value === "object") {
      const result = {};
      for (const key of Object.keys(value)) {
        result[key] = deepDecodeJson(value[key]);
      }
      return result;
    }
    return value;
  }

  // --- Utility: Extract action details from parsed message ---
  function extractActionInfo(message) {
    if (!message || !message.actions || !message.actions.length) return [];
    return message.actions.map((action) => {
      const info = {
        id: action.id,
        descriptor: action.descriptor,
        namespace: action.params?.namespace,
        classname: action.params?.classname,
        method: action.params?.method,
        params: null,
      };
      // Decode nested params
      if (action.params?.params) {
        info.params = deepDecodeJson(action.params.params);
      }
      return info;
    });
  }

  // --- Utility: Detect errors in response ---
  function detectErrors(responseBody) {
    const errors = [];
    if (!responseBody || !responseBody.actions) return errors;

    for (const action of responseBody.actions) {
      const actionId = action.id;
      const state = action.state;

      // Case 1: Explicit ERROR state
      if (state === "ERROR") {
        errors.push({
          actionId,
          state,
          severity: "error",
          message: action.error?.[0]?.message || action.error?.message || "Unknown error",
          errorCode: action.error?.[0]?.errorCode || action.errorCode || null,
          details: action.error,
        });
        continue;
      }

      // Case 2: SUCCESS state but returnValue contains errors
      if (state === "SUCCESS" && action.returnValue) {
        const rv = deepDecodeJson(action.returnValue);

        // Check returnValue.returnValue for nested error JSON
        const innerValue =
          typeof rv === "object" && rv.returnValue
            ? deepDecodeJson(rv.returnValue)
            : rv;

        const errorInfo = findErrorInObject(innerValue);
        if (errorInfo) {
          errors.push({
            actionId,
            state,
            severity: "error",
            message: errorInfo.message,
            errorCode: errorInfo.errorCode,
            details: innerValue,
          });
        }
      }
    }
    return errors;
  }

  // --- Utility: Check if an error string is actually a success indicator ---
  function isSuccessIndicator(str) {
    const normalized = str.trim().toLowerCase();
    return normalized === "ok" || normalized === "success" || normalized === "";
  }

  // --- Utility: Recursively find error indicators in an object ---
  function findErrorInObject(obj) {
    if (!obj || typeof obj !== "object") return null;

    // Direct error fields — only treat as error if the value is a meaningful error message
    if (obj.error && typeof obj.error === "string" && !isSuccessIndicator(obj.error)) {
      return { message: obj.error, errorCode: obj.errorCode || null };
    }
    if (obj.error && typeof obj.error === "object" && obj.error.message && !isSuccessIndicator(obj.error.message)) {
      return { message: obj.error.message, errorCode: obj.error.errorCode || obj.errorCode || null };
    }
    if (obj.errorMessage && typeof obj.errorMessage === "string" && !isSuccessIndicator(obj.errorMessage)) {
      return { message: obj.errorMessage, errorCode: obj.errorCode || null };
    }
    if (obj.IPResult && obj.IPResult.error && typeof obj.IPResult.error === "string" && !isSuccessIndicator(obj.IPResult.error)) {
      return {
        message: obj.IPResult.error,
        errorCode: obj.errorCode || obj.IPResult.errorCode || null,
      };
    }

    // Check for DRResult errors (DataRaptor)
    if (obj.DRResult && obj.DRResult.error && typeof obj.DRResult.error === "string" && !isSuccessIndicator(obj.DRResult.error)) {
      return { message: obj.DRResult.error, errorCode: obj.errorCode || null };
    }

    // Check nested "result" field
    if (obj.result && typeof obj.result === "object") {
      const nested = findErrorInObject(obj.result);
      if (nested) return nested;
    }

    // Do NOT treat a standalone errorCode without an error message as an error
    return null;
  }

  // --- Utility: Extract the dataSource type from request params ---
  function extractDataSourceType(actionInfo) {
    if (!actionInfo || !actionInfo.params) return null;
    const params = actionInfo.params;
    if (params.dataSourceMap?.type) return params.dataSourceMap.type;
    if (params.dataSourceMap) {
      const ds = deepDecodeJson(params.dataSourceMap);
      if (ds?.type) return ds.type;
    }
    return null;
  }

  // --- Utility: Extract IP/DR procedure name from request params ---
  function extractProcedureName(actionInfo) {
    if (!actionInfo || !actionInfo.params) return null;
    const params = actionInfo.params;
    // Integration Procedure
    if (params.dataSourceMap?.value?.ipMethod) {
      return params.dataSourceMap.value.ipMethod;
    }
    if (params.ipMethod) return params.ipMethod;
    // DataRaptor — bundleName or drMethod
    if (params.dataSourceMap?.value?.bundleName) {
      return params.dataSourceMap.value.bundleName;
    }
    if (params.dataSourceMap?.value?.drMethod) {
      return params.dataSourceMap.value.drMethod;
    }
    if (params.drMethod) return params.drMethod;
    // Apex Remote
    if (params.dataSourceMap?.value?.className && params.dataSourceMap?.value?.methodName) {
      return params.dataSourceMap.value.className + "." + params.dataSourceMap.value.methodName;
    }
    if (params.dataSourceMap?.value?.className) {
      return params.dataSourceMap.value.className;
    }
    // OmniScript
    if (params.sClassName) return params.sClassName;
    // Generic
    if (params.dataSourceMap) {
      const ds = deepDecodeJson(params.dataSourceMap);
      if (ds?.value?.ipMethod) return ds.value.ipMethod;
      if (ds?.value?.bundleName) return ds.value.bundleName;
      if (ds?.value?.drMethod) return ds.value.drMethod;
      if (ds?.value?.className && ds?.value?.methodName) {
        return ds.value.className + "." + ds.value.methodName;
      }
      if (ds?.value?.className) return ds.value.className;
    }
    return null;
  }

  // --- Utility: Format JSON with syntax highlighting ---
  function formatJson(obj, indent) {
    indent = indent || 0;
    const json = JSON.stringify(obj, null, 2);
    // Apply syntax highlighting via spans
    return json.replace(
      /("(?:[^"\\]|\\.)*")\s*:/g,
      '<span class="key">$1</span>:'
    ).replace(
      /:\s*("(?:[^"\\]|\\.)*")/g,
      function (match, val) {
        // Highlight error-like strings in red
        if (/error|fail|exception|not found|invalid/i.test(val)) {
          return ': <span class="value-error">' + val + "</span>";
        }
        return ': <span class="value-string">' + val + "</span>";
      }
    ).replace(
      /:\s*(\d+(?:\.\d+)?)/g,
      ': <span class="value-number">$1</span>'
    ).replace(
      /:\s*(null)/g,
      ': <span class="value-null">$1</span>'
    );
  }

  // --- Utility: Format timestamp ---
  function formatTime(date) {
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    });
  }

  // --- Create an error card element ---
  function createErrorCard(entry) {
    const card = document.createElement("div");
    card.className = "error-card" + (entry.severity === "warning" ? " severity-warning" : "") + (entry.isSuccess ? " success" : "");

    const dataSourceTypeTag = entry.dataSourceType
      ? `<span class="error-tag tag-datasource-type">${escapeHtml(entry.dataSourceType)}</span>`
      : "";
    const procedureTag = entry.procedure
      ? `<span class="error-tag tag-procedure">${escapeHtml(entry.procedure)}</span>`
      : "";
    const errorCodeTag = entry.errorCode
      ? `<span class="error-tag tag-error-code">${escapeHtml(entry.errorCode)}</span>`
      : "";
    const methodTag = entry.method
      ? `<span class="error-tag tag-method">${escapeHtml(entry.method)}</span>`
      : "";
    const actionIdTag = entry.actionId
      ? `<span class="error-tag tag-action-id">Action: ${escapeHtml(entry.actionId)}</span>`
      : "";

    const title = entry.isSuccess ? "✓ Success" : escapeHtml(entry.message);

    card.innerHTML = `
      <div class="error-header">
        <div>
          <div class="error-title">${title}</div>
          <div class="error-meta">
            <span class="error-tag tag-time">${formatTime(entry.time)}</span>
            ${dataSourceTypeTag}
            ${methodTag}
            ${procedureTag}
            ${errorCodeTag}
            ${actionIdTag}
          </div>
        </div>
      </div>
      <div class="error-details">
        ${entry.requestParams ? `
          <div class="detail-section">
            <div class="detail-label">Request Input</div>
            <div class="detail-content">${formatJson(entry.requestParams)}</div>
          </div>
        ` : ""}
        <div class="detail-section">
          <div class="detail-label">Response Details</div>
          <div class="detail-content">${formatJson(entry.details)}</div>
        </div>
        ${entry.url ? `
          <div class="detail-section">
            <div class="detail-label">URL</div>
            <div class="detail-content">${escapeHtml(entry.url)}</div>
          </div>
        ` : ""}
      </div>
    `;

    card.querySelector(".error-header").addEventListener("click", () => {
      card.classList.toggle("expanded");
    });

    return card;
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Add entry to the list ---
  function addEntry(entry) {
    entries.push(entry);

    if (!entry.isSuccess) {
      errorCount++;
      errorCountEl.textContent = errorCount;
      errorCountEl.classList.remove("zero");
    }

    // Only show in the list if it matches the current filter
    if (!entry.isSuccess || showAllCheckbox.checked) {
      const card = createErrorCard(entry);
      errorListEl.appendChild(card);
      emptyStateEl.classList.add("hidden");

      if (autoScrollCheckbox.checked) {
        errorListEl.scrollTop = errorListEl.scrollHeight;
      }
    } else if (entries.length === 1) {
      // Keep empty state visible if only successful requests so far
    }
  }

  // --- Refresh visible entries based on filter ---
  function refreshList() {
    errorListEl.innerHTML = "";
    const showAll = showAllCheckbox.checked;
    let visible = 0;

    for (const entry of entries) {
      if (!entry.isSuccess || showAll) {
        const card = createErrorCard(entry);
        errorListEl.appendChild(card);
        visible++;
      }
    }

    if (visible === 0) {
      emptyStateEl.classList.remove("hidden");
    } else {
      emptyStateEl.classList.add("hidden");
    }
  }

  // --- Clear all ---
  clearBtn.addEventListener("click", () => {
    entries = [];
    errorCount = 0;
    errorCountEl.textContent = "0";
    errorCountEl.classList.add("zero");
    errorListEl.innerHTML = "";
    emptyStateEl.classList.remove("hidden");
  });

  showAllCheckbox.addEventListener("change", refreshList);

  // --- Listen for network requests ---
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    const url = request.request.url;

    // Only process Salesforce Aura requests
    if (!url.includes("/aura") && !url.includes("/s/sfsites/aura")) {
      return;
    }

    // Get the request body
    const postData = request.request.postData;
    if (!postData || !postData.text) return;

    const message = parseAuraBody(postData.text);
    if (!message) return;

    const actionInfoList = extractActionInfo(message);

    // Only process requests that have a dataSourceMap with a type
    const relevantActions = actionInfoList.filter((a) => {
      const params = a.params;
      if (!params) return false;
      if (params.dataSourceMap?.type) return true;
      if (params.dataSourceMap) {
        const ds = deepDecodeJson(params.dataSourceMap);
        if (ds?.type) return true;
      }
      return false;
    });
    if (relevantActions.length === 0) return;

    // Get the response body
    request.getContent((content, encoding) => {
      if (!content) return;

      let responseBody;
      try {
        responseBody = JSON.parse(content);
      } catch (e) {
        return;
      }

      const errors = detectErrors(responseBody);
      const errorActionIds = new Set(errors.map((e) => e.actionId));

      // Only process relevant actions (those with dataSourceMap.type)
      const relevantActionIds = new Set(relevantActions.map((a) => a.id));

      // Always record errors (only for relevant actions)
      for (const error of errors) {
        if (!relevantActionIds.has(error.actionId)) continue;
        const actionInfo = relevantActions.find((a) => a.id === error.actionId) || relevantActions[0];
        const procedure = extractProcedureName(actionInfo);
        const dataSourceType = extractDataSourceType(actionInfo);

        addEntry({
          time: new Date(),
          message: error.message,
          errorCode: error.errorCode,
          severity: error.severity,
          actionId: error.actionId,
          method: actionInfo?.method || actionInfo?.classname,
          procedure: procedure,
          dataSourceType: dataSourceType,
          requestParams: actionInfo?.params,
          details: error.details,
          url: url,
          isSuccess: false,
        });
      }

      // Always record successful actions (for "show all" filtering)
      for (const actionInfo of relevantActions) {
        if (errorActionIds.has(actionInfo.id)) continue;
        const procedure = extractProcedureName(actionInfo);
        const dataSourceType = extractDataSourceType(actionInfo);
        addEntry({
          time: new Date(),
          message: "Success",
          errorCode: null,
          severity: "info",
          actionId: actionInfo.id,
          method: actionInfo?.method || actionInfo?.classname,
          procedure: procedure,
          dataSourceType: dataSourceType,
          requestParams: actionInfo?.params,
          details: deepDecodeJson(responseBody.actions?.find((a) => a.id === actionInfo.id)?.returnValue),
          url: url,
          isSuccess: true,
        });
      }
    });
  });

  // Initialize badge
  errorCountEl.classList.add("zero");
})();
