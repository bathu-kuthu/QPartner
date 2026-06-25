const fs = require('fs');
const path = require('path');

// Target directory
const dir = path.join(__dirname, '../assets/sounds');
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

const filepath = path.join(dir, 'booking_alert.wav');

// Audio params
const sampleRate = 22050; // lower sample rate to keep file small
const durationSeconds = 3;
const numSamples = sampleRate * durationSeconds;
const numChannels = 1;
const bitsPerSample = 16;
const bytesPerSample = bitsPerSample / 8;
const byteRate = sampleRate * numChannels * bytesPerSample;
const blockAlign = numChannels * bytesPerSample;

const wavHeaderSize = 44;
const dataSize = numSamples * bytesPerSample;
const fileSize = wavHeaderSize + dataSize - 8;

const buffer = Buffer.alloc(wavHeaderSize + dataSize);

// Write WAV Header
buffer.write('RIFF', 0);
buffer.writeUInt32LE(fileSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16); // format chunk size
buffer.writeUInt16LE(1, 20);  // linear PCM
buffer.writeUInt16LE(numChannels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(bitsPerSample, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

// Generate synthesized Porter/Rapido style ring (alternating beeps)
// We will alternate between active beeps and silence
for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    
    // Pattern: beep for 200ms, silent for 100ms, repeat
    const cycleTime = t % 0.3;
    let sampleVal = 0;
    
    if (cycleTime < 0.20) {
        // Multi-frequency alert beep (e.g. 880Hz and 1200Hz combined for a piercing alert)
        const f1 = 880;
        const f2 = 1200;
        const tone1 = Math.sin(2 * Math.PI * f1 * t);
        const tone2 = Math.sin(2 * Math.PI * f2 * t);
        
        // Combine and scale down to avoid clipping
        sampleVal = Math.round((tone1 * 0.5 + tone2 * 0.5) * 32767);
    }
    
    const offset = wavHeaderSize + i * 2;
    buffer.writeInt16LE(sampleVal, offset);
}

fs.writeFileSync(filepath, buffer);
console.log('Successfully generated booking_alert.wav at:', filepath);
