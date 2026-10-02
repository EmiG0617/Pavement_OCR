(() => {
  const elements = {
    cameraButton: document.querySelector("#camera-button"),
    captureButton: document.querySelector("#capture-button"),
    video: document.querySelector("#camera-video"),
    preview: document.querySelector("#image-preview"),
    placeholder: document.querySelector("#camera-placeholder"),
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
    worker: null,
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
    elements.preview.src = source;
    elements.preview.hidden = false;
    elements.video.classList.remove("visible");
    elements.placeholder.hidden = true;
    elements.captureButton.disabled = true;
    elements.ocrButton.disabled = false;
    setStep("review");
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
      elements.video.srcObject = state.stream;
      elements.video.classList.add("visible");
      elements.preview.hidden = true;
      elements.placeholder.hidden = true;
      elements.captureButton.disabled = false;
      elements.cameraButton.textContent = "Stop camera";
      await elements.video.play();
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
    elements.canvas.getContext("2d").drawImage(video, 0, 0);
    const image = new Image();
    image.onload = () => setPreview(elements.canvas.toDataURL("image/jpeg", 0.92), elements.canvas);
    image.onerror = () => notify("The captured image could not be prepared. Please try again.", true);
    image.src = elements.canvas.toDataURL("image/jpeg", 0.92);
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
      state.worker = await Tesseract.createWorker("eng", 1, {
        logger: (progress) => {
          if (progress.status) elements.ocrStatus.textContent = progress.status;
          if (typeof progress.progress === "number") {
            elements.progress.value = progress.progress;
            elements.ocrPercent.textContent = `${Math.round(progress.progress * 100)}%`;
          }
        },
      });
      const { data } = await state.worker.recognize(state.image);
      state.ocrLines = data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      renderOcrLines();
      renderPdfFields();
      elements.ocrStatus.textContent = "Recognition complete";
      elements.progress.value = 1;
      elements.ocrPercent.textContent = "100%";
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

  function renderOcrLines() {
    elements.textResults.replaceChildren();
    if (state.ocrLines.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const text = document.createElement("p");
      text.textContent = "No text was detected. Try another image.";
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
