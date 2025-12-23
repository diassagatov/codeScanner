// Модуль для сканирования промокодов
class PromoCodeScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.canvas = document.getElementById('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.scanZone = document.getElementById('scanZone');
        this.resultCode = document.getElementById('resultCode');
        this.resultContainer = document.getElementById('resultContainer');
        this.status = document.getElementById('status');
        this.overlayText = document.getElementById('overlayText');
        
        this.startBtn = document.getElementById('startBtn');
        this.retryBtn = document.getElementById('retryBtn');
        this.doneBtn = document.getElementById('doneBtn');
        
        this.stream = null;
        this.scanning = false;
        this.scanInterval = null;
        this.recognizedCode = '';
        
        this.init();
    }
    
    init() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.retryBtn.addEventListener('click', () => this.retry());
        this.doneBtn.addEventListener('click', () => this.done());
    }
    
    async startCamera() {
        try {
            this.updateStatus('Запуск камеры...', 'scanning');
            this.overlayText.textContent = 'Наведите камеру на промокод';
            
            const constraints = {
                video: {
                    facingMode: 'environment', // задняя камера
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                }
            };
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            
            await this.video.play();
            
            // Ждем загрузки видео
            await new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    this.canvas.width = this.video.videoWidth;
                    this.canvas.height = this.video.videoHeight;
                    resolve();
                };
            });
            
            this.startBtn.style.display = 'none';
            this.retryBtn.style.display = 'inline-block';
            this.doneBtn.style.display = 'inline-block';
            this.resultContainer.style.display = 'none';
            
            this.startScanning();
            
        } catch (error) {
            console.error('Ошибка доступа к камере:', error);
            this.updateStatus('Ошибка доступа к камере. Проверьте разрешения.', 'error');
        }
    }
    
    startScanning() {
        if (this.scanning) return;
        
        this.scanning = true;
        this.updateStatus('Сканирование...', 'scanning');
        this.overlayText.textContent = 'Сканирование...';
        
        // Сканируем каждые 1.5 секунды для более быстрого распознавания
        this.scanInterval = setInterval(() => {
            this.scanCode();
        }, 1500);
        
        // Первое сканирование через 0.5 секунды (даем камере сфокусироваться)
        setTimeout(() => {
            this.scanCode();
        }, 500);
    }
    
    stopScanning() {
        this.scanning = false;
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
        }
    }
    
    async scanCode() {
        if (!this.scanning || !this.video.videoWidth) return;
        
        try {
            // Получаем координаты зоны сканирования
            const scanRect = this.getScanZoneRect();
            
            // Рисуем текущий кадр на canvas
            this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            
            // Вырезаем область сканирования
            const imageData = this.ctx.getImageData(
                scanRect.x,
                scanRect.y,
                scanRect.width,
                scanRect.height
            );
            
            // Улучшаем изображение для лучшего распознавания
            const enhancedImageData = this.enhanceImage(imageData);
            
            // Создаем временный canvas для обработки
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = scanRect.width;
            tempCanvas.height = scanRect.height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.putImageData(enhancedImageData, 0, 0);
            
            // Распознаем текст
            const result = await this.recognizeText(tempCanvas);
            
            if (result && result.trim().length > 0) {
                this.recognizedCode = result.trim();
                this.displayResult(this.recognizedCode);
                this.updateStatus('Код распознан!', 'success');
                this.overlayText.textContent = 'Код распознан!';
                this.stopScanning();
            }
            
        } catch (error) {
            console.error('Ошибка сканирования:', error);
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
            height: scanZoneRect.height * scaleY
        };
    }
    
    enhanceImage(imageData) {
        const data = new Uint8ClampedArray(imageData.data);
        const width = imageData.width;
        const height = imageData.height;
        
        // Первый проход: конвертация в grayscale и увеличение контраста
        const grayscale = new Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            grayscale[i / 4] = gray;
        }
        
        // Вычисляем адаптивный порог (Otsu's method упрощенный)
        let sum = 0;
        for (let i = 0; i < grayscale.length; i++) {
            sum += grayscale[i];
        }
        const avg = sum / grayscale.length;
        const threshold = avg * 0.9; // Немного ниже среднего для белого фона
        
        // Второй проход: бинаризация с адаптивным порогом
        for (let i = 0; i < data.length; i += 4) {
            const gray = grayscale[i / 4];
            
            // Увеличиваем контраст
            const contrast = 2.0;
            const adjusted = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
            
            // Бинаризация (инвертируем для белого фона с черным текстом)
            const binary = adjusted > threshold ? 0 : 255;
            
            data[i] = binary;     // R
            data[i + 1] = binary; // G
            data[i + 2] = binary; // B
        }
        
        return new ImageData(data, width, height);
    }
    
    async recognizeText(canvas) {
        try {
            // Увеличиваем размер canvas для лучшего распознавания
            const scale = 3;
            const scaledCanvas = document.createElement('canvas');
            scaledCanvas.width = canvas.width * scale;
            scaledCanvas.height = canvas.height * scale;
            const scaledCtx = scaledCanvas.getContext('2d');
            
            // Используем сглаживание для лучшего качества
            scaledCtx.imageSmoothingEnabled = false;
            scaledCtx.drawImage(canvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
            
            const { data: { text, confidence } } = await Tesseract.recognize(
                scaledCanvas,
                'eng+rus', // английский и русский
                {
                    logger: m => {
                        if (m.status === 'recognizing text') {
                            // Можно показывать прогресс
                        }
                    },
                    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', // Только буквы и цифры
                    tessedit_pageseg_mode: '8' // Одна строка текста
                }
            );
            
            // Проверяем уверенность распознавания
            if (confidence < 30) {
                return '';
            }
            
            // Очищаем текст от лишних символов
            return this.cleanText(text);
        } catch (error) {
            console.error('Ошибка распознавания:', error);
            return '';
        }
    }
    
    cleanText(text) {
        // Удаляем лишние пробелы и переносы строк
        let cleaned = text
            .replace(/\s+/g, '')
            .replace(/\n/g, '')
            .replace(/[^A-Z0-9]/g, '') // Оставляем только буквы и цифры
            .trim()
            .toUpperCase();
        
        // Удаляем слишком короткие результаты (вероятно ошибка)
        if (cleaned.length < 3) {
            return '';
        }
        
        return cleaned;
    }
    
    displayResult(code) {
        this.resultCode.textContent = code;
        this.resultContainer.style.display = 'block';
    }
    
    updateStatus(message, type = '') {
        this.status.textContent = message;
        this.status.className = 'status ' + type;
    }
    
    retry() {
        this.stopScanning();
        this.resultContainer.style.display = 'none';
        this.recognizedCode = '';
        this.updateStatus('', '');
        this.overlayText.textContent = 'Наведите камеру на промокод';
        this.startScanning();
    }
    
    done() {
        this.stopScanning();
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.video.srcObject = null;
        
        this.startBtn.style.display = 'inline-block';
        this.retryBtn.style.display = 'none';
        this.doneBtn.style.display = 'none';
        
        if (this.recognizedCode) {
            this.updateStatus(`Код сохранен: ${this.recognizedCode}`, 'success');
        } else {
            this.updateStatus('Сканирование завершено', '');
        }
        
        this.overlayText.textContent = '';
    }
}

// Экспортируем функцию для использования
export function scanPromoCode(videoStream) {
    return new Promise(async (resolve, reject) => {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const video = document.createElement('video');
            
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
            const { data: { text } } = await Tesseract.recognize(canvas, 'eng+rus');
            const cleaned = cleanTextForPromoCode(text);
            
            resolve(cleaned);
        } catch (error) {
            reject(error);
        }
    });
}

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
    return text
        .replace(/\s+/g, ' ')
        .replace(/\n/g, '')
        .trim()
        .toUpperCase();
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    new PromoCodeScanner();
});

