(() => {
  const elements = {
    cameraButton: document.querySelector("#camera-button"),
    captureButton: document.querySelector("#capture-button"),
    video: document.querySelector("#camera-video"),
    preview: document.querySelector("#image-preview"),
    placeholder: document.querySelector("#camera-placeholder"),
    cropSelection: document.querySelector("#crop-selection"),
    cropControls: document.querySelector("#crop-controls"),
    cropSummary: document.querySelector("#crop-summary"),
    cropReset: document.querySelector("#crop-reset"),
    canvas: document.querySelector("#capture-canvas"),
    imageInput: document.querySelector("#image-input"),
    ocrButton: document.querySelector("#ocr-button"),
    progressWrap: document.querySelector("#ocr-progress-wrap"),
    progress: document.querySelector("#ocr-progress"),
    ocrStatus: document.querySelector("#ocr-status"),
    ocrPercent: document.querySelector("#ocr-percent"),
    textResults: document.querySelector("#text-results"),
    pdfInput: document.querySelector("#pdf-input"),
    pdfDropzone: document.querySelector("#pdf-dropzone"),
    pdfFileName: document.querySelector("#pdf-file-name"),
    pdfFields: document.querySelector("#pdf-fields"),
    downloadButton: document.querySelector("#download-button"),
    notice: document.querySelector("#notice"),
  };

  const state = {
    stream: null,
    image: null,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    cropDrag: null,
    worker: null,
    liveOcrRunId: 0,
    liveOcrPromise: null,
    pdfBytes: null,
    pdfName: "",
    fieldNames: [],
    ocrLines: [],
    values: new Map(),
    noticeTimer: null,
  };

  function notify(message, isError = false) {
    window.clearTimeout(state.noticeTimer);
    elements.notice.textContent = message;
    elements.notice.classList.toggle("error", isError);
    elements.notice.hidden = false;
    state.noticeTimer = window.setTimeout(() => {
      elements.notice.hidden = true;
    }, 6000);
  }

  function setPreview(source, image) {
    stopCamera();
    state.image = image;
    state.crop = { x: 0, y: 0, width: 1, height: 1 };
    elements.preview.parentElement.classList.add("has-image");
    elements.preview.src = source;
    elements.preview.hidden = false;
    elements.video.classList.remove("visible");
    elements.placeholder.hidden = true;
    elements.captureButton.disabled = true;
    elements.cameraButton.disabled = false;
    elements.ocrButton.disabled = false;
    elements.cropControls.hidden = false;
    renderCropSelection();
    setStep("review");
  }

  function getImageDisplayRect() {
    const frame = elements.preview.parentElement;
    const frameWidth = frame.clientWidth;
    const frameHeight = frame.clientHeight;
    const imageWidth = state.image.naturalWidth || state.image.width;
    const imageHeight = state.image.naturalHeight || state.image.height;
    const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return {
      left: (frameWidth - width) / 2,
      top: (frameHeight - height) / 2,
      width,
      height,
    };
  }

  function renderCropSelection() {
    if (!state.image) {
      elements.cropSelection.hidden = true;
      return;
    }
    const imageRect = getImageDisplayRect();
    elements.cropSelection.style.left = `${imageRect.left + state.crop.x * imageRect.width}px`;
    elements.cropSelection.style.top = `${imageRect.top + state.crop.y * imageRect.height}px`;
    elements.cropSelection.style.width = `${state.crop.width * imageRect.width}px`;
    elements.cropSelection.style.height = `${state.crop.height * imageRect.height}px`;
    const isWholeImage = state.crop.x === 0 && state.crop.y === 0 &&
      state.crop.width === 1 && state.crop.height === 1;
    elements.cropSummary.textContent = isWholeImage
      ? "OCR area: whole image. Drag a corner to select a smaller area."
      : "Custom OCR area selected. Drag a corner to adjust or move the frame.";
    elements.cropSelection.hidden = false;
  }

  function getCropPoint(event) {
    const frameRect = elements.preview.parentElement.getBoundingClientRect();
    const imageRect = getImageDisplayRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - frameRect.left - imageRect.left) / imageRect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - frameRect.top - imageRect.top) / imageRect.height)),
    };
  }

  function resizeCrop(crop, handle, point) {
    const right = crop.x + crop.width;
    const bottom = crop.y + crop.height;
    const minSize = 0.04;
    let left = crop.x;
    let top = crop.y;
    let nextRight = right;
    let nextBottom = bottom;

    if (handle.includes("w")) left = Math.min(point.x, right - minSize);
    if (handle.includes("e")) nextRight = Math.max(point.x, left + minSize);
    if (handle.includes("n")) top = Math.min(point.y, bottom - minSize);
    if (handle.includes("s")) nextBottom = Math.max(point.y, top + minSize);

    left = Math.max(0, left);
    top = Math.max(0, top);
    nextRight = Math.min(1, nextRight);
    nextBottom = Math.min(1, nextBottom);
    return {
      x: left,
      y: top,
      width: nextRight - left,
      height: nextBottom - top,
    };
  }

  function onCropPointerDown(event) {
    if (!state.image || event.button !== 0) return;
    const handle = event.target.closest("[data-crop-handle]")?.dataset.cropHandle;
    state.cropDrag = {
      pointerId: event.pointerId,
      handle: handle || "move",
      start: getCropPoint(event),
      crop: { ...state.crop },
    };
    event.preventDefault();
    elements.cropSelection.setPointerCapture(event.pointerId);
  }

  function onCropPointerMove(event) {
    if (!state.cropDrag || state.cropDrag.pointerId !== event.pointerId) return;
    const point = getCropPoint(event);
    if (state.cropDrag.handle === "move") {
      const { crop, start } = state.cropDrag;
      state.crop = {
        ...crop,
        x: Math.max(0, Math.min(1 - crop.width, crop.x + point.x - start.x)),
        y: Math.max(0, Math.min(1 - crop.height, crop.y + point.y - start.y)),
      };
    } else {
      state.crop = resizeCrop(state.cropDrag.crop, state.cropDrag.handle, point);
    }
    renderCropSelection();
  }

  function onCropPointerUp(event) {
    if (state.cropDrag?.pointerId === event.pointerId) state.cropDrag = null;
  }

  function onCropKeyDown(event) {
    const handle = event.target.closest("[data-crop-handle]")?.dataset.cropHandle;
    if (!handle || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.05 : 0.01;
    const point = {
      x: state.crop.x + (handle.includes("w") ? 0 : state.crop.width) +
        (event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0),
      y: state.crop.y + (handle.includes("n") ? 0 : state.crop.height) +
        (event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0),
    };
    state.crop = resizeCrop(state.crop, handle, point);
    renderCropSelection();
  }

  function setStep(stepName) {
    const steps = document.querySelectorAll("[data-step-indicator]");
    const order = ["capture", "review", "form"];
    const activeIndex = order.indexOf(stepName);
    steps.forEach((step, index) => {
      step.classList.toggle("active", index <= activeIndex);
    });
  }

  function stopCamera() {
    const cameraWasRunning = Boolean(state.stream);
    state.liveOcrRunId += 1;
    if (state.stream) {
      state.stream.getTracks().forEach((track) => track.stop());
      state.stream = null;
    }
    elements.video.srcObject = null;
    elements.video.classList.remove("visible");
    elements.preview.hidden = !state.image;
    elements.placeholder.hidden = Boolean(state.image);
    elements.captureButton.disabled = true;
    elements.cameraButton.textContent = "Start camera";
    elements.cropSelection.hidden = !state.image;
    elements.cropControls.hidden = !state.image;
    elements.preview.parentElement.classList.toggle("has-image", Boolean(state.image));
    if (cameraWasRunning) {
      elements.progressWrap.hidden = true;
      elements.ocrPercent.textContent = "";
      elements.ocrStatus.textContent = "Live OCR paused";
    }
    if (state.image) renderCropSelection();
  }

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      notify("Camera access is unavailable here. Open this app on HTTPS or localhost, or choose an image instead.", true);
      return;
    }
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      state.image = null;
      state.crop = { x: 0, y: 0, width: 1, height: 1 };
      state.ocrLines = [];
      renderOcrLines("Looking for text in the camera preview…");
      renderPdfFields();
      elements.ocrButton.disabled = true;
      elements.video.srcObject = state.stream;
      elements.video.classList.add("visible");
      elements.preview.hidden = true;
      elements.placeholder.hidden = true;
      elements.cropSelection.hidden = true;
      elements.cropControls.hidden = true;
      elements.preview.parentElement.classList.remove("has-image");
      elements.captureButton.disabled = false;
      elements.cameraButton.textContent = "Stop camera";
      await elements.video.play();
      elements.progressWrap.hidden = false;
      elements.progress.value = 0;
      elements.ocrPercent.textContent = "";
      elements.ocrStatus.textContent = "Starting live OCR…";
      const runId = state.liveOcrRunId + 1;
      state.liveOcrRunId = runId;
      state.liveOcrPromise = readLiveCamera(runId);
    } catch (error) {
      stopCamera();
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        notify("Camera permission was denied. Allow camera access in your browser settings, or choose an image instead.", true);
      } else {
        notify(`Could not start the camera: ${error.message || "check the device and browser permissions."}`, true);
      }
    }
  }

  function captureImage() {
    const video = elements.video;
    if (!state.stream || !video.videoWidth || !video.videoHeight) {
      notify("Wait for the camera preview to appear, then try capturing again.", true);
      return;
    }
    elements.canvas.width = video.videoWidth;
    elements.canvas.height = video.videoHeight;
    elements.canvas.getContext("2d").drawImage(video, 0, 0, elements.canvas.width, elements.canvas.height);
    const source = elements.canvas.toDataURL("image/jpeg", 0.92);
    const liveOcrPromise = state.liveOcrPromise;
    stopCamera();
    elements.cameraButton.disabled = true;
    const image = new Image();
    image.onload = async () => {
      try {
        if (liveOcrPromise) await liveOcrPromise;
        setPreview(source, image);
        elements.progressWrap.hidden = false;
        elements.progress.value = 1;
        elements.ocrPercent.textContent = "";
        elements.ocrStatus.textContent = "Capture saved · OCR frozen";
        notify("Frame captured. Live OCR is paused; review the frozen results.");
      } catch (error) {
        elements.cameraButton.disabled = false;
        notify(`Could not finish live OCR: ${error.message || error}`, true);
      }
    };
    image.onerror = () => {
      elements.cameraButton.disabled = false;
      notify("The captured image could not be prepared. Please try again.", true);
    };
    image.src = source;
  }

  async function readLiveCamera(runId) {
    let worker;
    const isCurrentRun = () => runId === state.liveOcrRunId && Boolean(state.stream);
    try {
      if (!window.Tesseract) {
        throw new Error("The OCR library did not load. Check your internet connection and reload the page.");
      }
      worker = await Tesseract.createWorker("eng", 1);
      if (!isCurrentRun()) return;
      state.worker = worker;
      await worker.setParameters({ tessedit_pageseg_mode: "6" });

      while (isCurrentRun()) {
        const video = elements.video;
        if (!video.videoWidth || !video.videoHeight) {
          await new Promise((resolve) => window.setTimeout(resolve, 200));
          continue;
        }
        const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
        const frame = document.createElement("canvas");
        frame.width = Math.max(1, Math.round(video.videoWidth * scale));
        frame.height = Math.max(1, Math.round(video.videoHeight * scale));
        frame.getContext("2d").drawImage(video, 0, 0, frame.width, frame.height);
        elements.ocrStatus.textContent = "Reading live camera…";
        elements.progress.removeAttribute("value");
        const { data } = await worker.recognize(frame);
        if (!isCurrentRun()) break;

        const lines = data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const text = lines.join("\n");
        if (text !== state.ocrLines.join("\n")) {
          state.ocrLines = lines;
          renderOcrLines("Looking for text in the camera preview…");
          renderPdfFields();
        }
        elements.ocrStatus.textContent = lines.length
          ? `Live OCR · ${lines.length} line${lines.length === 1 ? "" : "s"} found`
          : "Live OCR · looking for text…";
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    } catch (error) {
      if (isCurrentRun()) {
        elements.ocrStatus.textContent = "Live OCR could not be completed";
        notify(`Live OCR failed: ${error.message || error}`, true);
      }
    } finally {
      if (worker) {
        if (state.worker === worker) state.worker = null;
        await worker.terminate();
      }
      if (runId === state.liveOcrRunId) {
        elements.progressWrap.hidden = true;
        elements.ocrPercent.textContent = "";
      }
    }
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      notify("Choose a supported image file.", true);
      return;
    }
    const image = new Image();
    image.onload = () => setPreview(image.src, image);
    image.onerror = () => notify("This image could not be opened. Try a JPG, PNG, or another browser-supported image.", true);
    image.src = URL.createObjectURL(file);
  }

  function prepareOcrImages(image, crop) {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) {
      throw new Error("The image has no readable dimensions. Please choose another image.");
    }

    const sourceX = Math.floor(crop.x * sourceWidth);
    const sourceY = Math.floor(crop.y * sourceHeight);
    const cropWidth = Math.max(1, Math.min(sourceWidth - sourceX, Math.ceil(crop.width * sourceWidth)));
    const cropHeight = Math.max(1, Math.min(sourceHeight - sourceY, Math.ceil(crop.height * sourceHeight)));
    const scale = Math.min(2.5, 2600 / Math.max(cropWidth, cropHeight));
    const width = Math.max(1, Math.round(cropWidth * scale));
    const height = Math.max(1, Math.round(cropHeight * scale));
    const enhanced = document.createElement("canvas");
    enhanced.width = width;
    enhanced.height = height;
    const context = enhanced.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const histogram = new Uint32Array(256);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = Math.round(0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2]);
      histogram[gray] += 1;
      pixels[index] = gray;
      pixels[index + 1] = gray;
      pixels[index + 2] = gray;
    }

    const pixelCount = width * height;
    const percentileLevel = (fraction) => {
      const target = pixelCount * fraction;
      let count = 0;
      for (let level = 0; level < histogram.length; level += 1) {
        count += histogram[level];
        if (count >= target) return level;
      }
      return 255;
    };
    const low = percentileLevel(0.01);
    const high = percentileLevel(0.99);
    const contrastRange = Math.max(1, high - low);
    histogram.fill(0);
    for (let index = 0; index < pixels.length; index += 4) {
      const normalized = Math.max(0, Math.min(255, Math.round(16 + ((pixels[index] - low) * 223) / contrastRange)));
      histogram[normalized] += 1;
      pixels[index] = normalized;
      pixels[index + 1] = normalized;
      pixels[index + 2] = normalized;
    }

    let total = 0;
    for (let level = 0; level < histogram.length; level += 1) {
      total += level * histogram[level];
    }
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let threshold = 127;
    let bestVariance = 0;
    for (let level = 0; level < histogram.length; level += 1) {
      backgroundWeight += histogram[level];
      if (backgroundWeight === 0) continue;
      const foregroundWeight = pixelCount - backgroundWeight;
      if (foregroundWeight === 0) break;
      backgroundSum += level * histogram[level];
      const meanBackground = backgroundSum / backgroundWeight;
      const meanForeground = (total - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (meanBackground - meanForeground) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = level;
      }
    }

    let darkPixels = 0;
    for (let level = 0; level <= threshold; level += 1) darkPixels += histogram[level];
    const invert = darkPixels > pixelCount / 2;
    const binary = document.createElement("canvas");
    binary.width = width;
    binary.height = height;
    const binaryContext = binary.getContext("2d");
    const binaryData = binaryContext.createImageData(width, height);
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index];
      const value = (gray > threshold) !== invert ? 255 : 0;
      binaryData.data[index] = value;
      binaryData.data[index + 1] = value;
      binaryData.data[index + 2] = value;
      binaryData.data[index + 3] = 255;
    }
    binaryContext.putImageData(binaryData, 0, 0);
    context.putImageData(imageData, 0, 0);

    return [enhanced, binary];
  }

  async function recognizeText() {
    if (!state.image) {
      notify("Capture an equipment screen or choose an image before running OCR.", true);
      return;
    }
    elements.ocrButton.disabled = true;
    elements.progressWrap.hidden = false;
    elements.progress.value = 0;
    elements.ocrPercent.textContent = "0%";
    elements.ocrStatus.textContent = "Loading OCR engine…";
    try {
      if (!window.Tesseract) {
        throw new Error("The OCR library did not load. Check your internet connection and reload the page.");
      }
      const images = prepareOcrImages(state.image, state.crop);
      state.worker = await Tesseract.createWorker("eng", 1, {
        logger: (progress) => {
          if (progress.status) elements.ocrStatus.textContent = progress.status;
          if (typeof progress.progress === "number") {
            const passIndex = elements.progress.dataset.pass === "2" ? 1 : 0;
            const overallProgress = (passIndex + progress.progress) / images.length;
            elements.progress.value = overallProgress;
            elements.ocrPercent.textContent = `${Math.round(overallProgress * 100)}%`;
          }
        },
      });
      const results = [];
      for (let index = 0; index < images.length; index += 1) {
        elements.progress.dataset.pass = String(index + 1);
        elements.ocrStatus.textContent = index === 0 ? "Reading enhanced image…" : "Checking high-contrast image…";
        await state.worker.setParameters({
          tessedit_pageseg_mode: index === 0 ? "6" : "11",
        });
        const { data } = await state.worker.recognize(images[index]);
        results.push(data);
      }
      const bestResult = results.reduce((best, current) =>
        (current.confidence ?? 0) > (best.confidence ?? 0) ? current : best
      );
      state.ocrLines = bestResult.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      renderOcrLines();
      renderPdfFields();
      elements.ocrStatus.textContent = "Recognition complete";
      elements.progress.value = 1;
      elements.ocrPercent.textContent = "100%";
      elements.progress.removeAttribute("data-pass");
      if (state.ocrLines.length === 0) {
        notify("No text was detected. Try a sharper, brighter image with the screen filling more of the frame.", true);
      } else {
        notify(`Recognized ${state.ocrLines.length} text line${state.ocrLines.length === 1 ? "" : "s"}. Review and correct them before filling the form.`);
      }
    } catch (error) {
      elements.ocrStatus.textContent = "OCR could not be completed";
      notify(`OCR failed: ${error.message || error}`, true);
    } finally {
      if (state.worker) {
        await state.worker.terminate();
        state.worker = null;
      }
      elements.ocrButton.disabled = false;
    }
  }

  function renderOcrLines(emptyMessage = "No text was detected. Try another image.") {
    elements.textResults.replaceChildren();
    if (state.ocrLines.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const text = document.createElement("p");
      text.textContent = emptyMessage;
      empty.append(text);
      elements.textResults.append(empty);
      return;
    }

    state.ocrLines.forEach((line, index) => {
      const row = document.createElement("div");
      row.className = "ocr-line";
      const number = document.createElement("span");
      number.className = "line-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const input = document.createElement("input");
      input.type = "text";
      input.value = line;
      input.setAttribute("aria-label", `Recognized text line ${index + 1}`);
      input.addEventListener("input", () => {
        state.ocrLines[index] = input.value;
        renderPdfFields();
      });
      row.append(number, input);
      elements.textResults.append(row);
    });
  }

  function getSuggestedValue(fieldName) {
    const normalizedName = fieldName.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const line of state.ocrLines) {
      const labeledValue = line.match(/^\s*([^:=]{1,80})\s*[:=]\s*(.*?)\s*$/);
      if (!labeledValue) continue;
      const normalizedLabel = labeledValue[1].toLowerCase().replace(/[^a-z0-9]/g, "");
      if (normalizedName && normalizedName === normalizedLabel && labeledValue[2]) {
        return labeledValue[2];
      }
    }
    return "";
  }

  function renderPdfFields() {
    elements.pdfFields.replaceChildren();
    if (!state.pdfBytes) {
      const empty = document.createElement("div");
      empty.className = "empty-state compact";
      const text = document.createElement("p");
      text.textContent = "PDF text fields will appear here after you choose a form.";
      empty.append(text);
      elements.pdfFields.append(empty);
      updateDownloadButton();
      return;
    }
    if (state.fieldNames.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state compact";
      const text = document.createElement("p");
      text.textContent = "No fillable text fields were found in this PDF. Choose a PDF with AcroForm text fields.";
      empty.append(text);
      elements.pdfFields.append(empty);
      updateDownloadButton();
      return;
    }

    const count = document.createElement("div");
    count.className = "field-count";
    count.textContent = `${state.fieldNames.length} fillable text field${state.fieldNames.length === 1 ? "" : "s"}`;
    elements.pdfFields.append(count);

    state.fieldNames.forEach((name) => {
      const row = document.createElement("div");
      row.className = "mapping-row";
      const label = document.createElement("label");
      const inputId = `pdf-field-${state.fieldNames.indexOf(name)}`;
      label.htmlFor = inputId;
      label.textContent = name;
      label.title = name;
      const input = document.createElement("input");
      input.id = inputId;
      input.type = "text";
      input.setAttribute("list", "ocr-suggestions");
      input.setAttribute("aria-label", `Value for PDF field ${name}`);
      input.placeholder = "Select recognized text or enter a value";
      input.value = state.values.has(name) ? state.values.get(name) : getSuggestedValue(name);
      input.addEventListener("input", () => {
        state.values.set(name, input.value);
        updateDownloadButton();
      });
      row.append(label, input);
      elements.pdfFields.append(row);
    });

    const suggestions = document.createElement("datalist");
    suggestions.id = "ocr-suggestions";
    state.ocrLines.filter(Boolean).forEach((line) => {
      const option = document.createElement("option");
      option.value = line;
      suggestions.append(option);
    });
    elements.pdfFields.append(suggestions);
    updateDownloadButton();
  }

  function updateDownloadButton() {
    elements.downloadButton.disabled = !state.pdfBytes || state.fieldNames.length === 0;
  }

  async function loadPdf(file) {
    if (!file || (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))) {
      notify("Choose a PDF file.", true);
      return;
    }
    try {
      if (!window.PDFLib) {
        throw new Error("The PDF library did not load. Check your internet connection and reload the page.");
      }
      const bytes = await file.arrayBuffer();
      const pdfDocument = await PDFLib.PDFDocument.load(bytes);
      const fields = pdfDocument.getForm().getFields();
      state.fieldNames = [...new Set(fields
        .filter((field) => field instanceof PDFLib.PDFTextField)
        .map((field) => field.getName()))];
      state.pdfBytes = bytes;
      state.pdfName = file.name;
      state.values.clear();
      elements.pdfFileName.textContent = file.name;
      elements.pdfFileName.title = file.name;
      renderPdfFields();
      setStep("form");
      if (state.fieldNames.length === 0) {
        notify("This PDF has no fillable text fields. Choose an AcroForm PDF with text fields.", true);
      } else {
        notify(`Loaded ${file.name} with ${state.fieldNames.length} fillable text field${state.fieldNames.length === 1 ? "" : "s"}.`);
      }
    } catch (error) {
      state.pdfBytes = null;
      state.pdfName = "";
      state.fieldNames = [];
      elements.pdfFileName.textContent = "Choose a fillable PDF";
      elements.pdfFileName.removeAttribute("title");
      renderPdfFields();
      notify(`Could not read this PDF: ${error.message || error}`, true);
    }
  }

  async function downloadFilledPdf() {
    if (!state.pdfBytes || state.fieldNames.length === 0) {
      notify("Choose a fillable PDF before downloading.", true);
      return;
    }
    elements.downloadButton.disabled = true;
    try {
      const pdfDocument = await PDFLib.PDFDocument.load(state.pdfBytes);
      const form = pdfDocument.getForm();
      state.fieldNames.forEach((name) => {
        const value = state.values.has(name) ? state.values.get(name) : getSuggestedValue(name);
        if (value) form.getTextField(name).setText(value);
      });
      const pdfBytes = await pdfDocument.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const baseName = state.pdfName.replace(/\.pdf$/i, "");
      link.href = url;
      link.download = `${baseName || "form"}_filled.pdf`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify("Your completed PDF has been created and downloaded.");
    } catch (error) {
      notify(`Could not fill the PDF: ${error.message || error}`, true);
    } finally {
      updateDownloadButton();
    }
  }

  elements.cameraButton.addEventListener("click", () => {
    if (state.stream) stopCamera();
    else startCamera();
  });
  elements.captureButton.addEventListener("click", captureImage);
  elements.cropSelection.addEventListener("pointerdown", onCropPointerDown);
  elements.cropSelection.addEventListener("pointermove", onCropPointerMove);
  elements.cropSelection.addEventListener("pointerup", onCropPointerUp);
  elements.cropSelection.addEventListener("pointercancel", onCropPointerUp);
  elements.cropSelection.addEventListener("keydown", onCropKeyDown);
  elements.cropReset.addEventListener("click", () => {
    state.crop = { x: 0, y: 0, width: 1, height: 1 };
    renderCropSelection();
  });
  window.addEventListener("resize", () => {
    if (state.image && !state.stream) renderCropSelection();
  });
  elements.imageInput.addEventListener("change", (event) => {
    loadImageFile(event.target.files[0]);
    event.target.value = "";
  });
  elements.ocrButton.addEventListener("click", recognizeText);
  elements.pdfInput.addEventListener("change", (event) => {
    loadPdf(event.target.files[0]);
    event.target.value = "";
  });
  elements.downloadButton.addEventListener("click", downloadFilledPdf);
  elements.pdfDropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    elements.pdfDropzone.classList.add("drag-over");
  });
  elements.pdfDropzone.addEventListener("dragleave", () => elements.pdfDropzone.classList.remove("drag-over"));
  elements.pdfDropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.pdfDropzone.classList.remove("drag-over");
    loadPdf(event.dataTransfer.files[0]);
  });
  window.addEventListener("pagehide", stopCamera);
})();
