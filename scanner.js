// Модуль для сканирования промокодов
class PromoCodeScanner {
  constructor() {
    // Проверяем наличие всех необходимых элементов
    this.video = document.getElementById("video");
    this.canvas = document.getElementById("canvas");
    this.scanZone = document.getElementById("scanZone");
    this.resultCode = document.getElementById("resultCode");
    this.resultContainer = document.getElementById("resultContainer");
    this.status = document.getElementById("status");
    this.overlayText = document.getElementById("overlayText");

    this.startBtn = document.getElementById("startBtn");
    this.captureBtn = document.getElementById("captureBtn");
    this.retryBtn = document.getElementById("retryBtn");
    this.doneBtn = document.getElementById("doneBtn");

    if (!this.video || !this.canvas || !this.startBtn || !this.captureBtn) {
      throw new Error("Не найдены необходимые элементы на странице");
    }

    this.ctx = this.canvas.getContext("2d");
    this.stream = null;
    this.recognizedCode = "";

    this.init();
  }

  init() {
    this.startBtn.addEventListener("click", () => this.startCamera());
    this.captureBtn.addEventListener("click", () => this.captureAndAnalyze());
    this.retryBtn.addEventListener("click", () => this.retry());
    this.doneBtn.addEventListener("click", () => this.done());
  }

  async startCamera() {
    try {
      // Проверяем безопасный контекст (HTTPS или localhost)
      const isSecureContext =
        window.isSecureContext ||
        location.protocol === "https:" ||
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1";
      if (!isSecureContext) {
        throw new Error(
          "Для работы камеры требуется HTTPS или localhost. Откройте сайт через https:// или запустите локальный сервер."
        );
      }

      // Проверяем поддержку getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error(
          "Ваш браузер не поддерживает доступ к камере. Используйте современный браузер (Chrome, Firefox, Safari, Edge)."
        );
      }

      this.updateStatus("Запрос доступа к камере...", "scanning");
      this.overlayText.textContent = "Разрешите доступ к камере";

      // Отключаем кнопку на время запроса
      this.startBtn.disabled = true;

      const constraints = {
        video: {
          facingMode: { ideal: "environment" }, // задняя камера
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      };

      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.video.srcObject = this.stream;

      // Ждем, пока видео начнет воспроизводиться
      this.video.onloadedmetadata = () => {
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
      };

      await this.video.play();

      // Ждем загрузки метаданных
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Таймаут загрузки видео"));
        }, 5000);

        if (this.video.readyState >= 2) {
          clearTimeout(timeout);
          resolve();
        } else {
          this.video.onloadedmetadata = () => {
            clearTimeout(timeout);
            this.canvas.width = this.video.videoWidth;
            this.canvas.height = this.video.videoHeight;
            resolve();
          };
          this.video.onerror = () => {
            clearTimeout(timeout);
            reject(new Error("Ошибка загрузки видео"));
          };
        }
      });

      this.startBtn.style.display = "none";
      this.captureBtn.style.display = "inline-block";
      this.retryBtn.style.display = "none";
      this.doneBtn.style.display = "inline-block";
      this.resultContainer.style.display = "none";

      this.updateStatus(
        "Камера запущена. Наведите на промокод и нажмите 'Сфотографировать'",
        "success"
      );
      this.overlayText.textContent = "Наведите камеру на промокод";
    } catch (error) {
      console.error("Ошибка доступа к камере:", error);
      let errorMessage = "Ошибка доступа к камере. ";

      if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        errorMessage += "Разрешите доступ к камере в настройках браузера.";
      } else if (
        error.name === "NotFoundError" ||
        error.name === "DevicesNotFoundError"
      ) {
        errorMessage += "Камера не найдена.";
      } else if (
        error.name === "NotReadableError" ||
        error.name === "TrackStartError"
      ) {
        errorMessage += "Камера уже используется другим приложением.";
      } else {
        errorMessage += error.message || "Проверьте настройки браузера.";
      }

      this.updateStatus(errorMessage, "error");
      this.overlayText.textContent = "Ошибка";
      this.startBtn.disabled = false;
    }
  }

  async captureAndAnalyze() {
    if (!this.video.videoWidth) {
      this.updateStatus("Камера еще не готова. Подождите немного.", "error");
      return;
    }

    try {
      // Отключаем кнопку на время анализа
      this.captureBtn.disabled = true;
      this.updateStatus("Анализ изображения...", "scanning");
      this.overlayText.textContent = "Анализ...";

      // Получаем координаты зоны сканирования
      const scanRect = this.getScanZoneRect();

      // Убеждаемся, что размеры валидны
      if (scanRect.width <= 0 || scanRect.height <= 0) {
        this.updateStatus(
          "Ошибка: неверные размеры зоны сканирования",
          "error"
        );
        this.captureBtn.disabled = false;
        return;
      }

      // Рисуем текущий кадр на canvas (делаем снимок)
      this.ctx.drawImage(
        this.video,
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );

      // Вырезаем область сканирования с небольшим отступом для лучшего распознавания
      const padding = 5;
      const x = Math.max(0, scanRect.x - padding);
      const y = Math.max(0, scanRect.y - padding);
      const width = Math.min(
        this.canvas.width - x,
        scanRect.width + padding * 2
      );
      const height = Math.min(
        this.canvas.height - y,
        scanRect.height + padding * 2
      );

      const imageData = this.ctx.getImageData(x, y, width, height);

      // Пробуем несколько вариантов улучшения изображения
      const variants = this.createEnhancedVariants(imageData);
      const results = [];

      for (const enhancedImageData of variants) {
        // Создаем временный canvas для обработки
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext("2d");
        tempCtx.putImageData(enhancedImageData, 0, 0);

        // Распознаем текст
        const result = await this.recognizeText(tempCanvas);
        if (result && result.trim().length > 0) {
          results.push(result.trim());
        }
      }

      // Выбираем наиболее частый результат или первый валидный
      if (results.length > 0) {
        // Находим наиболее частый результат
        const counts = {};
        results.forEach((r) => {
          counts[r] = (counts[r] || 0) + 1;
        });
        const bestResult = Object.keys(counts).reduce((a, b) =>
          counts[a] > counts[b] ? a : b
        );

        this.recognizedCode = bestResult;
        this.displayResult(this.recognizedCode);
        this.updateStatus("Код распознан!", "success");
        this.overlayText.textContent = "Код распознан!";

        // Скрываем кнопку "Сфотографировать", показываем "Повторить"
        this.captureBtn.style.display = "none";
        this.retryBtn.style.display = "inline-block";
      } else {
        this.updateStatus(
          "Не удалось распознать код. Попробуйте еще раз.",
          "error"
        );
        this.overlayText.textContent = "Код не распознан";
      }

      this.captureBtn.disabled = false;
    } catch (error) {
      console.error("Ошибка анализа:", error);
      this.updateStatus("Ошибка при анализе изображения", "error");
      this.overlayText.textContent = "Ошибка";
      this.captureBtn.disabled = false;
    }
  }

  getScanZoneRect() {
    const videoRect = this.video.getBoundingClientRect();
    const scanZoneRect = this.scanZone.getBoundingClientRect();

    const scaleX = this.canvas.width / videoRect.width;
    const scaleY = this.canvas.height / videoRect.height;

    return {
      x: (scanZoneRect.left - videoRect.left) * scaleX,
      y: (scanZoneRect.top - videoRect.top) * scaleY,
      width: scanZoneRect.width * scaleX,
      height: scanZoneRect.height * scaleY,
    };
  }

  enhanceImage(imageData, method = "auto") {
    const data = new Uint8ClampedArray(imageData.data);
    const width = imageData.width;
    const height = imageData.height;

    // Конвертация в grayscale
    const grayscale = new Array(width * height);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      grayscale[i / 4] = gray;
    }

    // Вычисляем статистику для адаптивной обработки
    let sum = 0;
    let min = 255;
    let max = 0;
    for (let i = 0; i < grayscale.length; i++) {
      const val = grayscale[i];
      sum += val;
      min = Math.min(min, val);
      max = Math.max(max, val);
    }
    const avg = sum / grayscale.length;
    const range = max - min;

    // Адаптивный порог на основе гистограммы
    let threshold;
    if (method === "dark") {
      // Для темного текста на светлом фоне
      threshold = avg * 0.85;
    } else if (method === "light") {
      // Для светлого текста на темном фоне
      threshold = avg * 1.15;
    } else {
      // Автоматический выбор
      threshold = avg;
    }

    // Улучшение контраста и резкости
    const contrast = range < 50 ? 3.0 : 2.5; // Больше контраста для низкоконтрастных изображений

    for (let i = 0; i < data.length; i += 4) {
      const gray = grayscale[i / 4];

      // Увеличиваем контраст
      let adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));

      // Применяем резкость (unsharp mask упрощенный)
      const sharpness = 1.2;
      adjusted = Math.min(
        255,
        Math.max(0, adjusted * sharpness - gray * (sharpness - 1))
      );

      // Бинаризация с адаптивным порогом
      let binary;
      if (avg > 128) {
        // Светлый фон - темный текст
        binary = adjusted > threshold ? 0 : 255;
      } else {
        // Темный фон - светлый текст
        binary = adjusted > threshold ? 255 : 0;
      }

      data[i] = binary; // R
      data[i + 1] = binary; // G
      data[i + 2] = binary; // B
    }

    return new ImageData(data, width, height);
  }

  // Создает несколько вариантов улучшенного изображения
  createEnhancedVariants(imageData) {
    return [
      this.enhanceImage(imageData, "auto"),
      this.enhanceImage(imageData, "dark"),
      this.enhanceImage(imageData, "light"),
    ];
  }

  async recognizeText(canvas) {
    try {
      // Увеличиваем размер canvas для лучшего распознавания
      const scale = 4; // Увеличил для лучшего распознавания
      const scaledCanvas = document.createElement("canvas");
      scaledCanvas.width = canvas.width * scale;
      scaledCanvas.height = canvas.height * scale;
      const scaledCtx = scaledCanvas.getContext("2d");

      // Используем сглаживание для лучшего качества
      scaledCtx.imageSmoothingEnabled = false;
      scaledCtx.drawImage(
        canvas,
        0,
        0,
        scaledCanvas.width,
        scaledCanvas.height
      );

      // Пробуем несколько вариантов распознавания с разными настройками
      const recognitionPromises = [
        // Вариант 1: Автоматическая сегментация, все символы
        this.recognizeWithSettings(scaledCanvas, {
          tessedit_pageseg_mode: "3", // Полностью автоматическая сегментация
          tessedit_ocr_engine_mode: "1", // LSTM OCR Engine
        }),
        // Вариант 2: Одна строка, все символы
        this.recognizeWithSettings(scaledCanvas, {
          tessedit_pageseg_mode: "8", // Одна строка текста
          tessedit_ocr_engine_mode: "1",
        }),
        // Вариант 3: Один блок текста
        this.recognizeWithSettings(scaledCanvas, {
          tessedit_pageseg_mode: "6", // Один блок текста
          tessedit_ocr_engine_mode: "1",
        }),
        // Вариант 4: Только буквы и цифры (на случай если это поможет)
        this.recognizeWithSettings(scaledCanvas, {
          tessedit_pageseg_mode: "8",
          tessedit_ocr_engine_mode: "1",
          tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        }),
      ];

      // Ждем все варианты и выбираем лучший
      const results = await Promise.allSettled(recognitionPromises);
      let bestResult = "";
      let bestConfidence = 0;

      for (const result of results) {
        if (result.status === "fulfilled" && result.value) {
          const { text, confidence } = result.value;
          const cleaned = this.cleanText(text);
          if (cleaned.length >= 3 && confidence > bestConfidence) {
            bestResult = cleaned;
            bestConfidence = confidence;
          }
        }
      }

      // Если нашли результат с уверенностью > 20, возвращаем его
      if (bestConfidence > 20 && bestResult.length >= 3) {
        return bestResult;
      }

      return "";
    } catch (error) {
      console.error("Ошибка распознавания:", error);
      return "";
    }
  }

  async recognizeWithSettings(canvas, settings) {
    try {
      const defaultSettings = {
        logger: (m) => {
          // Можно показывать прогресс
        },
      };

      const {
        data: { text, confidence },
      } = await Tesseract.recognize(canvas, "eng+rus", {
        ...defaultSettings,
        ...settings,
      });

      return { text, confidence };
    } catch (error) {
      console.error("Ошибка в recognizeWithSettings:", error);
      return null;
    }
  }

  cleanText(text) {
    if (!text) return "";

    // Удаляем лишние пробелы и переносы строк
    let cleaned = text
      .replace(/\s+/g, "")
      .replace(/\n/g, "")
      .replace(/\r/g, "")
      .replace(/[|]/g, "I") // Заменяем | на I
      .trim()
      .toUpperCase();

    // Сначала пробуем оставить все символы (буквы, цифры, дефисы, подчеркивания)
    let withSpecial = cleaned.replace(/[^A-Z0-9\-_]/g, "");

    // Если есть результат с спецсимволами, используем его
    if (withSpecial.length >= 2) {
      cleaned = withSpecial;
    } else {
      // Иначе только буквы и цифры
      cleaned = cleaned.replace(/[^A-Z0-9]/g, "");
    }

    // Удаляем слишком короткие результаты (вероятно ошибка)
    if (cleaned.length < 2) {
      return "";
    }

    return cleaned;
  }

  displayResult(code) {
    this.resultCode.textContent = code;
    this.resultContainer.style.display = "block";
  }

  updateStatus(message, type = "") {
    this.status.textContent = message;
    this.status.className = "status " + type;
  }

  retry() {
    this.resultContainer.style.display = "none";
    this.recognizedCode = "";
    this.updateStatus(
      "Камера запущена. Наведите на промокод и нажмите 'Сфотографировать'",
      "success"
    );
    this.overlayText.textContent = "Наведите камеру на промокод";
    this.captureBtn.style.display = "inline-block";
    this.retryBtn.style.display = "none";
  }

  done() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.video.srcObject = null;

    this.startBtn.style.display = "inline-block";
    this.captureBtn.style.display = "none";
    this.retryBtn.style.display = "none";
    this.doneBtn.style.display = "none";

    if (this.recognizedCode) {
      this.updateStatus(`Код сохранен: ${this.recognizedCode}`, "success");
    } else {
      this.updateStatus("Сканирование завершено", "");
    }

    this.overlayText.textContent = "";
    this.resultContainer.style.display = "none";
  }
}

// Экспортируем функцию для использования (если используется как модуль)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { scanPromoCode, PromoCodeScanner };
}

// Глобальная функция для использования
window.scanPromoCode = function scanPromoCode(videoStream) {
  return new Promise(async (resolve, reject) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const video = document.createElement("video");

      video.srcObject = videoStream;
      await video.play();

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      ctx.drawImage(video, 0, 0);

      // Улучшаем изображение
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const enhanced = enhanceImageForOCR(imageData);
      ctx.putImageData(enhanced, 0, 0);

      // Распознаем текст
      const {
        data: { text },
      } = await Tesseract.recognize(canvas, "eng+rus");
      const cleaned = cleanTextForPromoCode(text);

      resolve(cleaned);
    } catch (error) {
      reject(error);
    }
  });
};

function enhanceImageForOCR(imageData) {
  const data = new Uint8ClampedArray(imageData.data);

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const contrast = 1.5;
    const adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
    const binary = adjusted > 128 ? 255 : 0;

    data[i] = binary;
    data[i + 1] = binary;
    data[i + 2] = binary;
  }

  return new ImageData(data, imageData.width, imageData.height);
}

function cleanTextForPromoCode(text) {
  return text.replace(/\s+/g, " ").replace(/\n/g, "").trim().toUpperCase();
}

// Инициализация при загрузке страницы
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initScanner();
  });
} else {
  initScanner();
}

function initScanner() {
  try {
    console.log("Инициализация сканера промокодов...");
    const scanner = new PromoCodeScanner();
    window.scanner = scanner; // Для отладки
    console.log("Сканер успешно инициализирован");
  } catch (error) {
    console.error("Ошибка инициализации сканера:", error);
    const status = document.getElementById("status");
    if (status) {
      status.textContent =
        "Ошибка инициализации. Проверьте консоль браузера (F12).";
      status.className = "status error";
    }
  }
}
