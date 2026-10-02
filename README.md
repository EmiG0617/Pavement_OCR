# Screen to Form

A browser-based prototype for reading equipment screens and filling existing PDF forms.

## Features

- Capture an equipment display with a device camera or select an image.
- Enhance image contrast and compare English OCR results from grayscale and high-contrast versions with Tesseract.js.
- Review and edit recognized lines before they are used.
- Open a fillable PDF, map recognized text (or manually entered values) to its AcroForm text fields, and download a completed copy.
- Keep images and PDFs on the user's device; the app does not upload them.

## Run locally

This is a static browser app. Open the project with a local web server or a VS Code extension such as Live Server. Camera access requires `localhost` or HTTPS; choosing an image works without camera access. The OCR and PDF libraries are loaded from jsDelivr, so an internet connection is required.

Open `index.html` from the local server in a current desktop or mobile browser.

## Notes

- The PDF must contain AcroForm text fields. Scanned or flattened PDFs cannot be filled by this prototype.
- Field names are shown as-is. Check each value and field assignment before downloading.
- OCR and PDF editing happen in the browser. Requests for the libraries, OCR language data, and web fonts go to their respective CDNs; the screen image and PDF file are not sent to those services.
- Automatic value suggestions are best-effort only. Always review the mapped values before downloading.
- OCR quality depends on the source image. Frame the display closely, keep it in focus and straight, and avoid glare; enhanced preprocessing cannot restore detail from blurry or very small text.
