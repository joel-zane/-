// ============================================================
//  ARGENTUM PHOTO RESTORATION LAB
//  Core Image Processing Engine
// ============================================================

'use strict';

// -------- State --------
const state = {
  originalImageData: null,
  currentImageData: null,
  history: [],
  notchPoints: [],
  processing: false,
  dims: { w: 0, h: 0 }
};

// -------- Canvas refs --------
const origCanvas = document.getElementById('originalCanvas');
const procCanvas = document.getElementById('processedCanvas');
const workCanvas = document.getElementById('workCanvas');
const specCanvas = document.getElementById('spectrumCanvas');
const origCtx = origCanvas.getContext('2d');
const procCtx = procCanvas.getContext('2d');
const workCtx = workCanvas.getContext('2d');
const specCtx = specCanvas.getContext('2d');

// -------- UI refs --------
const fileInput = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');
const progressFill = document.getElementById('progressFill');
const statusMsg = document.getElementById('statusMsg');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const imageDims = document.getElementById('imageDims');
const emptyStateOrig = document.getElementById('emptyStateOrig');
const emptyStateProc = document.getElementById('emptyStateProc');
const historyList = document.getElementById('historyList');
const notchList = document.getElementById('notchList');
const spectrumOverlay = document.getElementById('spectrumOverlay');
const appliedOps = document.getElementById('appliedOps');
const currentOpLabel = document.getElementById('currentOpLabel');

// -------- Slider syncs --------
const sliders = {
  claheTile: { el: document.getElementById('claheTile'), valEls: ['claheTileVal'], fmt: v => v },
  claheClip: { el: document.getElementById('claheClip'), valEls: ['claheClipVal'], fmt: v => parseFloat(v).toFixed(1) },
  kernelSize: { el: document.getElementById('kernelSize'), valEls: ['kernelVal','kernelVal2'], fmt: v => v },
  gaussSigma: { el: document.getElementById('gaussSigma'), valEls: ['sigmaVal'], fmt: v => parseFloat(v).toFixed(1) },
  sharpenAmount: { el: document.getElementById('sharpenAmount'), valEls: ['sharpenVal'], fmt: v => parseFloat(v).toFixed(1) },
  fftCutoff: { el: document.getElementById('fftCutoff'), valEls: ['cutoffVal'], fmt: v => v },
  retinexSigma: { el: document.getElementById('retinexSigma'), valEls: ['retinexSigmaVal'], fmt: v => v },
};

Object.entries(sliders).forEach(([key, cfg]) => {
  cfg.el.addEventListener('input', () => {
    cfg.valEls.forEach(id => {
      document.getElementById(id).textContent = cfg.fmt(cfg.el.value);
    });
  });
});

// ============================================================
// UPLOAD & FILE HANDLING
// ============================================================
uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) loadImage(file);
});

fileInput.addEventListener('change', e => {
  if (e.target.files[0]) loadImage(e.target.files[0]);
});

function loadImage(file) {
  if (!file.type.match(/image\/(jpeg|png|webp)/)) {
    showToast('请上传 JPG、PNG 或 WEBP 格式的图片', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1200;
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim/w, maxDim/h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      state.dims = { w, h };
      // Setup canvases
      [origCanvas, procCanvas, workCanvas].forEach(c => { c.width = w; c.height = h; });
      // Draw original
      origCtx.drawImage(img, 0, 0, w, h);
      const imgData = origCtx.getImageData(0, 0, w, h);
      state.originalImageData = imgData;
      state.currentImageData = copyImageData(imgData);
      // Update UI
      emptyStateOrig.style.display = 'none';
      emptyStateProc.style.display = 'none';
      origCanvas.style.display = 'block';
      procCanvas.style.display = 'block';
      // Show original in proc canvas too
      procCtx.putImageData(imgData, 0, 0);
      // Enable all buttons
      document.querySelectorAll('.btn:disabled').forEach(b => {
        if (b.id !== 'btnReset' && b.id !== 'btnDownload') b.disabled = false;
      });
      document.getElementById('btnReset').disabled = false;
      document.getElementById('btnDownload').disabled = false;
      document.getElementById('btnAutoFix').disabled = false;
      // Update header
      statusDot.classList.add('active');
      statusText.textContent = file.name;
      imageDims.textContent = `${w} × ${h} px`;
      // Reset history
      state.history = [];
      state.notchPoints = [];
      renderHistory();
      updateMetrics();
      showToast(`已加载: ${file.name}`, 'success');
      setStatus('图像已加载，可开始修复');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================================
// CORE UTILITIES
// ============================================================
function copyImageData(src) {
  const dst = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  return dst;
}

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function setProgress(p) { progressFill.style.width = p + '%'; }

function setStatus(msg) { statusMsg.textContent = msg; }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => t.classList.remove('show'), 2800);
}

// Push a result to history and display
function pushResult(imageData, label, icon = '◎') {
  // Save thumbnail
  const th = document.createElement('canvas');
  th.width = 60; th.height = 40;
  th.getContext('2d').putImageData(scaleImageData(imageData, 60, 40), 0, 0);
  state.history.push({ 
    imageData: copyImageData(imageData), 
    label, 
    icon, 
    thumb: th.toDataURL() 
  });
  state.currentImageData = copyImageData(imageData);
  procCtx.putImageData(imageData, 0, 0);
  currentOpLabel.textContent = label;
  renderHistory();
  updateMetrics();
  addOpTag(label);
}

function scaleImageData(src, tw, th) {
  const tmp = document.createElement('canvas');
  tmp.width = src.width; tmp.height = src.height;
  tmp.getContext('2d').putImageData(src, 0, 0);
  const out = document.createElement('canvas');
  out.width = tw; out.height = th;
  out.getContext('2d').drawImage(tmp, 0, 0, tw, th);
  return out.getContext('2d').getImageData(0, 0, tw, th);
}

function renderHistory() {
  if (state.history.length === 0) {
    historyList.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:12px;">暂无操作记录</div>';
    return;
  }
  historyList.innerHTML = '';
  state.history.forEach((item, i) => {
    const el = document.createElement('div');
    el.className = 'history-item' + (i === state.history.length - 1 ? ' current' : '');
    el.innerHTML = `<img class="history-thumb" src="${item.thumb}"><span>${item.icon} ${item.label}</span>`;
    el.addEventListener('click', () => {
      state.currentImageData = copyImageData(item.imageData);
      procCtx.putImageData(item.imageData, 0, 0);
      currentOpLabel.textContent = item.label;
      updateMetrics();
      document.querySelectorAll('.history-item').forEach((e,j) => e.classList.toggle('current', j===i));
    });
    historyList.appendChild(el);
  });
  historyList.scrollTop = historyList.scrollHeight;
}

function addOpTag(label) {
  const tag = document.createElement('div');
  tag.className = 'op-tag';
  tag.innerHTML = `<div class="op-tag-dot"></div><span>${label}</span>`;
  appliedOps.appendChild(tag);
  if (appliedOps.children.length > 4) appliedOps.removeChild(appliedOps.firstChild);
}

// -------- RGB <-> HSV helpers --------
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    switch(max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, v * 100];
}

function hsvToRgb(h, s, v) {
  h /= 360; s /= 100; v /= 100;
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch(i % 6) {
    case 0: r=v; g=t; b=p; break;
    case 1: r=q; g=v; b=p; break;
    case 2: r=p; g=v; b=t; break;
    case 3: r=p; g=q; b=v; break;
    case 4: r=t; g=p; b=v; break;
    case 5: r=v; g=p; b=q; break;
  }
  return [r * 255, g * 255, b * 255];
}

function getGray(data, i) {
  return 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
}

// ============================================================
// 1. HISTOGRAM EQUALIZATION (Global HE)
// ============================================================
function histogramEqualization(imageData) {
  const data = imageData.data;
  const w = imageData.width, h = imageData.height;
  const N = w * h;
  const result = copyImageData(imageData);
  const rd = result.data;

  // Process each pixel in YUV-like space (operate on luminance only)
  // First get histogram of V channel
  const hist = new Array(256).fill(0);
  const hsvData = new Float32Array(N * 3);

  for (let i = 0; i < N; i++) {
    const idx = i * 4;
    const hsv = rgbToHsv(data[idx], data[idx+1], data[idx+2]);
    hsvData[i*3] = hsv[0];
    hsvData[i*3+1] = hsv[1];
    hsvData[i*3+2] = hsv[2];
    hist[Math.round(hsv[2] * 2.55)]++;
  }

  // CDF
  const cdf = new Array(256).fill(0);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
  
  const minCdf = cdf.find(x => x > 0);
  const map = cdf.map(v => ((v - minCdf) / (N - minCdf)) * 100);

  for (let i = 0; i < N; i++) {
    const idx = i * 4;
    const newVal = map[Math.round(hsvData[i*3+2] * 2.55)];
    const rgb = hsvToRgb(hsvData[i*3], hsvData[i*3+1], newVal);
    rd[idx] = rgb[0];
    rd[idx+1] = rgb[1];
    rd[idx+2] = rgb[2];
  }
  return result;
}

// ============================================================
// 2. CLAHE (Contrast Limited Adaptive Histogram Equalization)
// ============================================================
function runCLAHE(imageData, tileSize, clipLimit) {
  const w = imageData.width, h = imageData.height;
  const data = imageData.data;
  const result = copyImageData(imageData);
  const rd = result.data;

  const hsvData = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const hsv = rgbToHsv(data[i*4], data[i*4+1], data[i*4+2]);
    hsvData[i*3] = hsv[0];
    hsvData[i*3+1] = hsv[1];
    hsvData[i*3+2] = hsv[2] * 2.55; // Normalize to 0-255
  }

  const numTilesX = Math.ceil(w / tileSize);
  const numTilesY = Math.ceil(h / tileSize);
  const histograms = [];

  for (let ty = 0; ty < numTilesY; ty++) {
    for (let tx = 0; tx < numTilesX; tx++) {
      const hist = new Array(256).fill(0);
      for (let y = ty * tileSize; y < Math.min((ty + 1) * tileSize, h); y++) {
        for (let x = tx * tileSize; x < Math.min((tx + 1) * tileSize, w); x++) {
          hist[Math.round(hsvData[(y * w + x) * 3 + 2])]++;
        }
      }
      
      // Clip histogram
      if (clipLimit > 0) {
        const actualClip = (clipLimit * tileSize * tileSize) / 256;
        let excess = 0;
        for (let i = 0; i < 256; i++) {
          if (hist[i] > actualClip) {
            excess += hist[i] - actualClip;
            hist[i] = actualClip;
          }
        }
        const add = excess / 256;
        for (let i = 0; i < 256; i++) hist[i] += add;
      }

      // CDF
      const cdf = new Array(256).fill(0);
      cdf[0] = hist[0];
      for (let i = 1; i < 256; i++) cdf[i] = cdf[i-1] + hist[i];
      const total = cdf[255];
      histograms.push(cdf.map(v => (v / total) * 255));
    }
  }

  // Bilinear interpolation
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = (x - tileSize / 2) / tileSize;
      const ty = (y - tileSize / 2) / tileSize;
      
      const tx1 = Math.max(0, Math.floor(tx));
      const tx2 = Math.min(numTilesX - 1, tx1 + 1);
      const ty1 = Math.max(0, Math.floor(ty));
      const ty2 = Math.min(numTilesY - 1, ty1 + 1);

      const fx = tx - tx1;
      const fy = ty - ty1;
      const val = hsvData[(y * w + x) * 3 + 2];

      const v11 = histograms[ty1 * numTilesX + tx1][Math.round(val)];
      const v12 = histograms[ty1 * numTilesX + tx2][Math.round(val)];
      const v21 = histograms[ty2 * numTilesX + tx1][Math.round(val)];
      const v22 = histograms[ty2 * numTilesX + tx2][Math.round(val)];

      const finalV = (1 - fx) * (1 - fy) * v11 + fx * (1 - fy) * v12 + (1 - fx) * fy * v21 + fx * fy * v22;
      
      const rgb = hsvToRgb(hsvData[(y * w + x) * 3], hsvData[(y * w + x) * 3 + 1], finalV / 2.55);
      const idx = (y * w + x) * 4;
      rd[idx] = rgb[0]; rd[idx+1] = rgb[1]; rd[idx+2] = rgb[2];
    }
  }
  return result;
}

// ============================================================
// 3. SPATIAL FILTERS (Median, Gaussian, Sharpen)
// ============================================================
function medianFilter(imageData, size) {
  const w = imageData.width, h = imageData.height;
  const data = imageData.data;
  const result = copyImageData(imageData);
  const rd = result.data;
  const offset = Math.floor(size / 2);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const valsR = [], valsG = [], valsB = [];
      for (let ky = -offset; ky <= offset; ky++) {
        for (let kx = -offset; kx <= offset; kx++) {
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const idx = (py * w + px) * 4;
          valsR.push(data[idx]);
          valsG.push(data[idx+1]);
          valsB.push(data[idx+2]);
        }
      }
      valsR.sort((a, b) => a - b);
      valsG.sort((a, b) => a - b);
      valsB.sort((a, b) => a - b);
      const mid = Math.floor(valsR.length / 2);
      const outIdx = (y * w + x) * 4;
      rd[outIdx] = valsR[mid];
      rd[outIdx+1] = valsG[mid];
      rd[outIdx+2] = valsB[mid];
    }
  }
  return result;
}

function gaussianBlur(imageData, size, sigma) {
  const w = imageData.width, h = imageData.height;
  const data = imageData.data;
  const result = copyImageData(imageData);
  const rd = result.data;
  const offset = Math.floor(size / 2);
  
  // Create kernel
  const kernel = [];
  let sum = 0;
  for (let y = -offset; y <= offset; y++) {
    for (let x = -offset; x <= offset; x++) {
      const g = Math.exp(-(x*x + y*y) / (2 * sigma * sigma));
      kernel.push(g);
      sum += g;
    }
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -offset; ky <= offset; ky++) {
        for (let kx = -offset; kx <= offset; kx++) {
          const py = Math.min(h - 1, Math.max(0, y + ky));
          const px = Math.min(w - 1, Math.max(0, x + kx));
          const idx = (py * w + px) * 4;
          const weight = kernel[(ky + offset) * size + (kx + offset)];
          r += data[idx] * weight;
          g += data[idx+1] * weight;
          b += data[idx+2] * weight;
        }
      }
      const outIdx = (y * w + x) * 4;
      rd[outIdx] = r; rd[outIdx+1] = g; rd[outIdx+2] = b;
    }
  }
  return result;
}

function laplacianSharpen(imageData, amount) {
  const w = imageData.width, h = imageData.height;
  const data = imageData.data;
  const result = copyImageData(imageData);
  const rd = result.data;
  const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0]; // Composite sharpening kernel

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const idx = ((y + ky) * w + (x + kx)) * 4;
          const weight = kernel[(ky + 1) * 3 + (kx + 1)];
          r += data[idx] * weight;
          g += data[idx+1] * weight;
          b += data[idx+2] * weight;
        }
      }
      const outIdx = (y * w + x) * 4;
      // Blend with original based on amount
      rd[outIdx] = clamp(data[outIdx] * (1 - amount) + r * amount);
      rd[outIdx+1] = clamp(data[outIdx+1] * (1 - amount) + g * amount);
      rd[outIdx+2] = clamp(data[outIdx+2] * (1 - amount) + b * amount);
    }
  }
  return result;
}

function unsharpMask(imageData, amount) {
  const blurred = gaussianBlur(imageData, 5, 1.0);
  const result = copyImageData(imageData);
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (i % 4 === 3) continue; // Skip alpha
    const mask = imageData.data[i] - blurred.data[i];
    result.data[i] = clamp(imageData.data[i] + mask * amount);
    result.data[i+1] = clamp(imageData.data[i+1] + (imageData.data[i+1] - blurred.data[i+1]) * amount);
    result.data[i+2] = clamp(imageData.data[i+2] + (imageData.data[i+2] - blurred.data[i+2]) * amount);
  }
  return result;
}

// ============================================================
// 4. FREQUENCY DOMAIN (FFT)
// ============================================================
// FFT Utils (Minimal implementation)
const FFTUtils = {
  // Simple Cooley-Tukey FFT for 2^n
  bitReverse(n, bits) {
    let r = 0;
    for (let i = 0; i < bits; i++) {
      r = (r << 1) | (n & 1);
      n >>= 1;
    }
    return r;
  },
  
  transform1D(real, imag, inverse = false) {
    const n = real.length;
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      const j = this.bitReverse(i, bits);
      if (j > i) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = 2 * Math.PI / len * (inverse ? -1 : 1);
      const wlenR = Math.cos(ang);
      const wlenI = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wR = 1, wI = 0;
        for (let j = 0; j < len / 2; j++) {
          const uR = real[i + j], uI = imag[i + j];
          const vR = real[i + j + len / 2] * wR - imag[i + j + len / 2] * wI;
          const vI = real[i + j + len / 2] * wR + imag[i + j + len / 2] * wI;
          real[i + j] = uR + vR;
          imag[i + j] = uI + vI;
          real[i + j + len / 2] = uR - vR;
          imag[i + j + len / 2] = uI - vI;
          const tmpR = wR * wlenR - wI * wlenI;
          wI = wR * wlenI + wI * wlenR;
          wR = tmpR;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) { real[i] /= n; imag[i] /= n; }
    }
  },

  nextPowerOf2(n) {
    return Math.pow(2, Math.ceil(Math.log2(n)));
  }
};

function runFFT(imageData, filterFn) {
  const w = imageData.width, h = imageData.height;
  const nw = FFTUtils.nextPowerOf2(w), nh = FFTUtils.nextPowerOf2(h);
  
  // We process gray or each channel? For performance, let's do luminance
  const real = new Float32Array(nw * nh);
  const imag = new Float32Array(nw * nh);
  const hsvData = new Float32Array(w * h * 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const hsv = rgbToHsv(imageData.data[idx], imageData.data[idx+1], imageData.data[idx+2]);
      hsvData[(y * w + x) * 3] = hsv[0];
      hsvData[(y * w + x) * 3 + 1] = hsv[1];
      hsvData[(y * w + x) * 3 + 2] = hsv[2];
      // Centering: multiply by (-1)^(x+y)
      const sign = ((x + y) % 2 === 0) ? 1 : -1;
      real[y * nw + x] = hsv[2] * sign;
    }
  }

  // 2D FFT
  for (let y = 0; y < nh; y++) {
    const r = real.subarray(y * nw, (y + 1) * nw);
    const i = imag.subarray(y * nw, (y + 1) * nw);
    FFTUtils.transform1D(r, i);
  }
  for (let x = 0; x < nw; x++) {
    const r = new Float32Array(nh), i = new Float32Array(nh);
    for (let y = 0; y < nh; y++) { r[y] = real[y * nw + x]; i[y] = imag[y * nw + x]; }
    FFTUtils.transform1D(r, i);
    for (let y = 0; y < nh; y++) { real[y * nw + x] = r[y]; imag[y * nw + x] = i[y]; }
  }

  // Filter
  const spectrum = filterFn(real, imag, nw, nh);

  // Inverse 2D FFT
  for (let x = 0; x < nw; x++) {
    const r = new Float32Array(nh), i = new Float32Array(nh);
    for (let y = 0; y < nh; y++) { r[y] = real[y * nw + x]; i[y] = imag[y * nw + x]; }
    FFTUtils.transform1D(r, i, true);
    for (let y = 0; y < nh; y++) { real[y * nw + x] = r[y]; imag[y * nw + x] = i[y]; }
  }
  for (let y = 0; y < nh; y++) {
    const r = real.subarray(y * nw, (y + 1) * nw);
    const i = imag.subarray(y * nw, (y + 1) * nw);
    FFTUtils.transform1D(r, i, true);
  }

  const result = copyImageData(imageData);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sign = ((x + y) % 2 === 0) ? 1 : -1;
      const v = real[y * nw + x] * sign;
      const rgb = hsvToRgb(hsvData[(y * w + x) * 3], hsvData[(y * w + x) * 3 + 1], clamp(v));
      const idx = (y * w + x) * 4;
      result.data[idx] = rgb[0]; result.data[idx+1] = rgb[1]; result.data[idx+2] = rgb[2];
    }
  }
  return { result, spectrum };
}

// ============================================================
// 5. ADVANCED FILTERS (Homomorphic, Retinex)
// ============================================================
function homomorphicFilter(imageData, gL, gH, D0) {
  return runFFT(imageData, (real, imag, nw, nh) => {
    const centerW = nw / 2, centerH = nh / 2;
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const d2 = (x - centerW)**2 + (y - centerH)**2;
        const h = (gH - gL) * (1 - Math.exp(-d2 / (D0 * D0))) + gL;
        real[y * nw + x] *= h;
        imag[y * nw + x] *= h;
      }
    }
  }).result;
}

function singleScaleRetinex(imageData, sigma) {
  const blurred = gaussianBlur(imageData, Math.round(sigma * 3), sigma);
  const result = copyImageData(imageData);
  for (let i = 0; i < imageData.data.length; i += 4) {
    if (i % 4 === 3) continue;
    // Log(I) - Log(G*I)
    const val = Math.log10(imageData.data[i] + 1) - Math.log10(blurred.data[i] + 1);
    // Simple gain/offset normalization for display
    result.data[i] = clamp(val * 128 + 128);
  }
  return result;
}

// ============================================================
// 6. METRICS & ANALYSIS
// ============================================================
function calculateMetrics(orig, proc) {
  const w = orig.width, h = orig.height;
  const d1 = orig.data, d2 = proc.data;
  
  // PSNR
  let mse = 0;
  for (let i = 0; i < d1.length; i += 4) {
    const g1 = getGray(d1, i), g2 = getGray(d2, i);
    mse += (g1 - g2) ** 2;
  }
  mse /= (w * h);
  const psnr = mse === 0 ? '∞' : (10 * Math.log10(255**2 / mse)).toFixed(1);

  // Entropy
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d2.length; i += 4) hist[Math.round(getGray(d2, i))]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    const p = hist[i] / (w * h);
    if (p > 0) entropy -= p * Math.log2(p);
  }

  // Contrast (Standard Deviation of gray)
  let avg = 0;
  for (let i = 0; i < d2.length; i += 4) avg += getGray(d2, i);
  avg /= (w * h);
  let std = 0;
  for (let i = 0; i < d2.length; i += 4) std += (getGray(d2, i) - avg)**2;
  const contrast = Math.sqrt(std / (w * h)).toFixed(1);

  // Sharpness (Tenengrad - Gradient magnitude)
  let sharp = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = (y * w + x) * 4;
      const gx = getGray(d2, idx + 4) - getGray(d2, idx - 4);
      const gy = getGray(d2, idx + w * 4) - getGray(d2, idx - w * 4);
      sharp += (gx * gx + gy * gy);
    }
  }
  sharp = Math.sqrt(sharp / (w * h)).toFixed(1);

  return { psnr, entropy: entropy.toFixed(2), contrast, sharp };
}

function updateMetrics() {
  if (!state.originalImageData || !state.currentImageData) return;
  const m = calculateMetrics(state.originalImageData, state.currentImageData);
  document.getElementById('metricPSNR').textContent = m.psnr;
  document.getElementById('metricEntropy').textContent = m.entropy;
  document.getElementById('metricContrast').textContent = m.contrast;
  document.getElementById('metricSharpness').textContent = m.sharp;
}

// ============================================================
// UI EVENT HANDLERS & WRAPPERS
// ============================================================
async function runOp(opFn, label, icon) {
  if (state.processing || !state.currentImageData) return;
  state.processing = true;
  setStatus(`正在处理: ${label}...`);
  setProgress(20);
  
  // Use timeout to let UI update
  setTimeout(() => {
    try {
      const startTime = performance.now();
      const result = opFn(state.currentImageData);
      const time = (performance.now() - startTime).toFixed(0);
      setProgress(100);
      pushResult(result, label, icon);
      setStatus(`${label} 处理完成 (${time}ms)`);
      showToast(`${label} 已应用`);
      setTimeout(() => setProgress(0), 1000);
    } catch (e) {
      console.error(e);
      showToast('处理失败', 'error');
      setStatus('错误: 处理中止');
      setProgress(0);
    }
    state.processing = false;
  }, 50);
}

// --- FFT & Spectrum UI ---
document.getElementById('btnShowSpectrum').addEventListener('click', () => {
  if (!state.currentImageData) return;
  const { spectrum } = runFFT(state.currentImageData, (r, i, nw, nh) => {
    const spec = new Float32Array(nw * nh);
    for (let j = 0; j < nw * nh; j++) {
      spec[j] = Math.log(1 + Math.sqrt(r[j]**2 + i[j]**2));
    }
    return spec;
  });
  
  const nw = FFTUtils.nextPowerOf2(state.dims.w);
  const nh = FFTUtils.nextPowerOf2(state.dims.h);
  specCanvas.width = nw; specCanvas.height = nh;
  const specData = specCtx.createImageData(nw, nh);
  
  // Find max for normalization
  let max = 0;
  for (let i = 0; i < spectrum.length; i++) if (spectrum[i] > max) max = spectrum[i];
  
  for (let i = 0; i < spectrum.length; i++) {
    const v = (spectrum[i] / max) * 255;
    const idx = i * 4;
    specData.data[idx] = specData.data[idx+1] = specData.data[idx+2] = v;
    specData.data[idx+3] = 255;
  }
  specCtx.putImageData(specData, 0, 0);
  spectrumOverlay.classList.add('visible');
  renderNotchList();
});

specCanvas.addEventListener('click', e => {
  const rect = specCanvas.getBoundingClientRect();
  const x = Math.round((e.clientX - rect.left) * (specCanvas.width / rect.width));
  const y = Math.round((e.clientY - rect.top) * (specCanvas.height / rect.height));
  state.notchPoints.push({ x, y });
  // Also add symmetric point
  state.notchPoints.push({ x: specCanvas.width - x, y: specCanvas.height - y });
  renderNotchList();
  
  // Draw marker
  specCtx.strokeStyle = '#d4a843';
  specCtx.lineWidth = 2;
  specCtx.strokeRect(x-3, y-3, 6, 6);
  specCtx.strokeRect(specCanvas.width-x-3, specCanvas.height-y-3, 6, 6);
});

function renderNotchList() {
  notchList.innerHTML = '';
  state.notchPoints.forEach((p, i) => {
    if (i % 2 !== 0) return; // Only show pairs
    const tag = document.createElement('div');
    tag.className = 'notch-tag';
    tag.textContent = `点 ${i/2+1}: (${p.x},${p.y})`;
    tag.onclick = () => {
      state.notchPoints.splice(i, 2);
      // We'd need to redraw the spectrum to remove visual markers
      renderNotchList();
    };
    notchList.appendChild(tag);
  });
}

document.getElementById('btnApplyNotch').addEventListener('click', () => {
  if (state.notchPoints.length === 0) return;
  runOp(img => {
    const { result } = runFFT(img, (real, imag, nw, nh) => {
      state.notchPoints.forEach(p => {
        // Simple notch: zero out a small area
        const radius = 3;
        for (let ny = p.y - radius; ny <= p.y + radius; ny++) {
          for (let nx = p.x - radius; nx <= p.x + radius; nx++) {
            if (ny >= 0 && ny < nh && nx >= 0 && nx < nw) {
              real[ny * nw + nx] = 0; imag[ny * nw + nx] = 0;
            }
          }
        }
      });
    });
    return result;
  }, '陷波去网纹', '⊗');
  spectrumOverlay.classList.remove('visible');
});

document.getElementById('btnClearNotch').addEventListener('click', () => {
  state.notchPoints = [];
  renderNotchList();
  showToast('已清除所有标记点');
});

document.getElementById('btnCloseSpectrum').addEventListener('click', () => {
  spectrumOverlay.classList.remove('visible');
});

// --- Button Wiring ---
document.getElementById('btnHE').addEventListener('click', () => runOp(histogramEqualization, '直方图均衡化', '◧'));

document.getElementById('btnCLAHE').addEventListener('click', () => {
  const tile = parseInt(document.getElementById('claheTile').value);
  const clip = parseFloat(document.getElementById('claheClip').value);
  runOp(img => runCLAHE(img, tile, clip), `CLAHE (T:${tile}, C:${clip})`, '◨');
});

document.getElementById('btnMedian').addEventListener('click', () => {
  const size = parseInt(document.getElementById('kernelSize').value);
  runOp(img => medianFilter(img, size), `中值滤波 ${size}px`, '◈');
});

document.getElementById('btnGaussian').addEventListener('click', () => {
  const size = parseInt(document.getElementById('kernelSize').value);
  const sigma = parseFloat(document.getElementById('gaussSigma').value);
  runOp(img => gaussianBlur(img, size, sigma), `高斯滤波 σ=${sigma}`, '◉');
});

document.getElementById('btnLaplacian').addEventListener('click', () => {
  const amount = parseFloat(document.getElementById('sharpenAmount').value);
  runOp(img => laplacianSharpen(img, amount), `拉普拉斯锐化 x${amount}`, '△');
});

document.getElementById('btnUnsharp').addEventListener('click', () => {
  const amount = parseFloat(document.getElementById('sharpenAmount').value);
  runOp(img => unsharpMask(img, amount), `USM 锐化 x${amount}`, '◇');
});

document.getElementById('btnFFTLow').addEventListener('click', () => {
  const type = document.getElementById('fftFilterType').value;
  const D0 = parseInt(document.getElementById('fftCutoff').value);
  runOp(img => {
    const { result } = runFFT(img, (real, imag, nw, nh) => {
      const centerW = nw / 2, centerH = nh / 2;
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const d = Math.sqrt((x - centerW)**2 + (y - centerH)**2);
          let h = 0;
          if (type === 'ideal') h = d <= D0 ? 1 : 0;
          else if (type === 'gaussian') h = Math.exp(-(d*d) / (2 * D0 * D0));
          else if (type === 'butterworth') h = 1 / (1 + (d / D0)**4);
          real[y * nw + x] *= h;
          imag[y * nw + x] *= h;
        }
      }
    });
    return result;
  }, `频域低通 (${type})`, '〜');
});

document.getElementById('btnHomomorphic').addEventListener('click', () => {
  runOp(img => homomorphicFilter(img, 0.5, 2.0, 40), '同态滤波', '☀');
});

document.getElementById('btnRetinex').addEventListener('click', () => {
  const sigma = parseInt(document.getElementById('retinexSigma').value);
  runOp(img => singleScaleRetinex(img, sigma), `Retinex σ=${sigma}`, '◌');
});

// --- Auto Fix Logic ---
async function autoFix() {
  if (state.processing || !state.currentImageData) return;
  state.processing = true;
  setStatus('正在执行智能自动修复流水线...');
  
  const pipeline = [
    { name: '自动对比度 (CLAHE)', fn: img => runCLAHE(img, 8, 2.0), p: 30 },
    { name: '智能去噪 (中值)', fn: img => medianFilter(img, 3), p: 60 },
    { name: '细节增强 (USM)', fn: img => unsharpMask(img, 0.8), p: 90 }
  ];

  let currentImg = copyImageData(state.originalImageData);
  for (const step of pipeline) {
    setProgress(step.p);
    setStatus(`自动修复: ${step.name}...`);
    // Give UI a chance to breathe
    await new Promise(r => setTimeout(r, 200));
    currentImg = step.fn(currentImg);
  }
  
  pushResult(currentImg, '一键自动修复', '✦');
  setProgress(100);
  setStatus('自动修复完成');
  showToast('已完成一键修复组合拳');
  setTimeout(() => setProgress(0), 1000);
  state.processing = false;
}

document.getElementById('btnAutoFix').addEventListener('click', autoFix);

document.getElementById('btnReset').addEventListener('click', () => {
  if (!state.originalImageData) return;
  state.currentImageData = copyImageData(state.originalImageData);
  procCtx.putImageData(state.originalImageData, 0, 0);
  state.history = [];
  state.notchPoints = [];
  renderHistory();
  renderNotchList();
  appliedOps.innerHTML = '';
  currentOpLabel.textContent = '—';
  updateMetrics();
  setStatus('已重置到原始图像');
  showToast('已重置到原始图像');
  spectrumOverlay.classList.remove('visible');
});

document.getElementById('btnDownload').addEventListener('click', () => {
  if (!state.currentImageData) return;
  const link = document.createElement('a');
  link.download = 'restored_' + Date.now() + '.png';
  link.href = procCanvas.toDataURL('image/png');
  link.click();
  showToast('图像已下载');
});

// Init
setStatus('就绪 · 待命');