import mimetypes
import os
import re
import struct
import time
import wave
import traceback
from google import genai
from google.genai import types

# ==================================================
# 1. ГЛОБАЛЬНЫЕ НАСТРОЙКИ
# ==================================================
API_KEY = "AQ.Ab8RN6K_WXw9jvntz4XDZ6q_cBFvgv6C_QStYCamqqt7UMwriw"  # ❗ ВСТАВЬ СЮДА СВОЙ КЛЮЧ
INPUT_TEXT_FILE = "book.txt"
OUTPUT_FINAL_FILE = "FINAL_AUDIOBOOK.wav"
MAX_CHUNK_LENGTH = 1200

# Идеальный тайминг для Free Tier (3 запроса в минуту = 1 запрос раз в 20 секунд)
DELAY_BETWEEN_REQUESTS = 21.0 

# ==================================================
# 2. РАСПРЕДЕЛЕНИЕ РОЛЕЙ И ГОЛОСОВ (КАСТИНГ АЛКрафт)
# ==================================================
CHARACTER_VOICES = {
    "Рассказчик": "Charon",       # Плотный, нейтральный и повествующий 
    "Игнатусик": "Zephyr",        # Молодой, энергичный, главный герой
    
    # Ученые и работники
    "Профессор Паров": "Fenrir",  # Старый, строгий
    "Профессор Тропцев": "Fenrir",
    "Мюллер": "Charon",           # Строгий руководитель 
    "Ученый": "Puck",             # Обычный голос
    "Работник": "Puck",           
    "Жанна": "Aoede",             # Женский, спокойный голос
    "Оповещение": "Kore",         # Холодный/роботизированный женский (сирена)
    
    # Второстепенные и старики
    "Дед Степан": "Fenrir",       # Дед из лаборатории (хрипловатый)
    "Дедушка": "Charon",          # Старики с баз выживших
    "Дед": "Charon",
    "Старушка": "Leda",           # Бабка
    
    # Бандиты и другие
    "Султан": "Fenrir",           # Угрожающий, грубый 
    "Водитель": "Puck",
    "Охранник": "Zephyr",
    "Кто-то": "Puck",
    
    # Монстры
    "Существо": "Leda",           # Загадочный и низкий женский (монстр)
}
AVAILABLE_VOICES = ["Puck", "Aoede", "Fenrir", "Kore", "Leda", "Charon", "Zephyr"]
VOICE_INDEX = 0

def get_voice_for_character(character: str) -> str:
    """Умная выдача голосов, если персонаж не прописан заранее."""
    global VOICE_INDEX
    # Нормализуем имя для точного поиска
    char_key = character.strip()
    
    if char_key not in CHARACTER_VOICES:
        # Присваиваем один из доступных голосов и запоминаем
        assigned_voice = AVAILABLE_VOICES[VOICE_INDEX % len(AVAILABLE_VOICES)]
        CHARACTER_VOICES[char_key] = assigned_voice
        VOICE_INDEX += 1
        
    return CHARACTER_VOICES[char_key]

# ==================================================
# 3. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (WAV & CHUNK SPLITTER)
# ==================================================
def parse_audio_mime_type(mime_type: str) -> dict[str, int]:
    bits_per_sample, rate = 16, 24000
    for param in mime_type.split(";"):
        param = param.strip()
        if param.lower().startswith("rate="):
            try: rate = int(param.split("=", 1)[1])
            except: pass 
        elif param.startswith("audio/L"):
            try: bits_per_sample = int(param.split("L", 1)[1])
            except: pass 
    return {"bits_per_sample": bits_per_sample, "rate": rate}

def convert_to_wav(audio_data: bytes, mime_type: str) -> bytes:
    p = parse_audio_mime_type(mime_type)
    num_channels, block_align = 1, 1 * (p["bits_per_sample"] // 8)
    byte_rate = p["rate"] * block_align
    chunk_size = 36 + len(audio_data)
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", chunk_size, b"WAVE", b"fmt ", 16, 1, 
                         num_channels, p["rate"], byte_rate, block_align, 
                         p["bits_per_sample"], b"data", len(audio_data))
    return header + audio_data

def parse_and_chunk_text(text: str) -> list[dict]:
    lines = text.split('\n')
    parsed_lines = []
    
    for line in lines:
        line = line.strip()
        if not line: continue
        match = re.match(r"^([A-Za-zА-Яа-яЁё0-9\s-]{2,40}?):\s*(.*)", line)
        if match:
            speaker = match.group(1).strip()
            text_val = match.group(2).strip()
            if text_val: parsed_lines.append({"speaker": speaker, "text": text_val})
        else:
            parsed_lines.append({"speaker": "Рассказчик", "text": line})

    chunks, current_chunk_lines, current_speakers, current_len = [], [], set(), 0

    for item in parsed_lines:
        speaker, txt_len = item["speaker"], len(item["text"])
        would_exceed_speakers = (speaker not in current_speakers) and (len(current_speakers) == 2)
        would_exceed_length = (current_len + txt_len > MAX_CHUNK_LENGTH) and len(current_chunk_lines) > 0

        if would_exceed_speakers or would_exceed_length:
            chunks.append({"speakers": list(current_speakers), "lines": current_chunk_lines})
            current_chunk_lines, current_speakers, current_len = [item], {speaker}, txt_len
        else:
            current_chunk_lines.append(item)
            current_speakers.add(speaker)
            current_len += txt_len

    if current_chunk_lines:
        chunks.append({"speakers": list(current_speakers), "lines": current_chunk_lines})
    return chunks

# ==================================================
# 4. ГЛАВНЫЙ ГЕНЕРАТОР (ЗАЩИТА ОТ 429)
# ==================================================
def generate_audiobook():
    if "ТВОЙ" in API_KEY or not API_KEY:
        print("🚨 ОШИБКА: Замени API_KEY в начале скрипта!")
        return
    if not os.path.exists(INPUT_TEXT_FILE):
        print(f"❌ Файл {INPUT_TEXT_FILE} не найден!")
        return

    with open(INPUT_TEXT_FILE, "r", encoding="utf-8") as f:
        full_text = f.read()

    chunks = parse_and_chunk_text(full_text)
    print(f"📚 Книга порезана на {len(chunks)} диалогов/монологов.")

    client = genai.Client(api_key=API_KEY)
    generated_files = []
    success_count = 0

    for index, chunk in enumerate(chunks):
        file_name = f"part_{index + 1:04d}.wav"
        speakers = chunk["speakers"]
        lines = chunk["lines"]

        print(f"\n🎥 СЦЕНА {index + 1}/{len(chunks)} | Спикеры: {', '.join(speakers)}")

        # УМНАЯ ПРОПУСКАЛКА: если файл уже есть, не тратим квоту!
        if os.path.exists(file_name):
            print(f"   ⏩ Файл {file_name} уже готов. Пропускаем (Экономим API!).")
            generated_files.append(file_name)
            success_count += 1
            continue

        if len(speakers) == 1:
            spk = speakers[0]
            voice_name = get_voice_for_character(spk)
            text_to_send = " ".join([l["text"] for l in lines])
            
            config = types.GenerateContentConfig(
                temperature=1.0,
                response_modalities=["audio"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice_name))
                )
            )
            contents = [types.Content(role="user", parts=[types.Part.from_text(text=text_to_send)])]
            print(f"   🎙️ Режим монолога. {spk} [{voice_name}]")

        else:
            spk1, spk2 = speakers[0], speakers[1]
            voice1, voice2 = get_voice_for_character(spk1), get_voice_for_character(spk2)

            transcript = "## Transcript:\n"
            for line in lines:
                spk_id = "Speaker 1" if line["speaker"] == spk1 else "Speaker 2"
                transcript += f"{spk_id}: {line['text']}\n"

            config = types.GenerateContentConfig(
                temperature=1.0,
                response_modalities=["audio"],
                speech_config=types.SpeechConfig(
                    multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(
                        speaker_voice_configs=[
                            types.SpeakerVoiceConfig(speaker="Speaker 1", voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice1))),
                            types.SpeakerVoiceConfig(speaker="Speaker 2", voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice2)))
                        ]
                    )
                )
            )
            contents = [types.Content(role="user", parts=[types.Part.from_text(text=transcript)])]
            print(f"   🎭 Режим диалога. {spk1} [{voice1}] и {spk2} [{voice2}]")

        # Пытаемся запустить до 3-х раз, если вдруг гугл блочит
        max_retries = 3
        for attempt in range(max_retries):
            try:
                for response_chunk in client.models.generate_content_stream(
                    model="gemini-2.5-flash-preview-tts", contents=contents, config=config,
                ):
                    if response_chunk.parts is None: continue
                    if response_chunk.parts[0].inline_data and response_chunk.parts[0].inline_data.data:
                        inline_data = response_chunk.parts[0].inline_data
                        data_buffer = inline_data.data
                        if mimetypes.guess_extension(inline_data.mime_type) is None:
                            data_buffer = convert_to_wav(inline_data.data, inline_data.mime_type)
                            
                        with open(file_name, "wb") as f:
                            f.write(data_buffer)
                
                generated_files.append(file_name)
                print(f"   ✅ Аудио {file_name} сохранено!")
                success_count += 1
                time.sleep(DELAY_BETWEEN_REQUESTS) # Ждем, чтобы не поймать 429 на следующей
                break # Успешно, выходим из цикла попыток
                
            except Exception as e:
                error_msg = str(e)
                if "429" in error_msg or "RESOURCE_EXHAUSTED" in error_msg:
                    print(f"   ⚠️ Слишком много запросов (Гугл ругается). Отдыхаем 30 секунд... (Попытка {attempt+1} из {max_retries})")
                    time.sleep(30)
                else:
                    print(f"❌ Критическая ошибка: {e}")
                    traceback.print_exc()
                    break # Неизвестная ошибка, прерываем полностью
        else:
            print("🚨 Не удалось обойти блокировку Гугла после 3 попыток. Останавливаем.")
            break

    # Склейка, если есть хотя бы что-то
    if generated_files:
        merge_wav_files(generated_files, OUTPUT_FINAL_FILE, success_count == len(chunks))

# ==================================================
# 5. СКЛЕЙКА АУДИОКНИГИ
# ==================================================
def merge_wav_files(wav_files: list[str], output_filename: str, clean_up: bool):
    print(f"\n🎧 Начинаем склейку {len(wav_files)} частей аудиокниги...")
    data = []
    
    for file in wav_files:
        try:
            with wave.open(file, 'rb') as w:
                data.append([w.getparams(), w.readframes(w.getnframes())])
        except: pass
            
    if not data: return

    with wave.open(output_filename, 'wb') as output:
        output.setparams(data[0][0])
        for params, frames in data:
            output.writeframes(frames)
            
    print(f"🔥 ГОТОВО! Склеенная аудиокнига: {output_filename}")
    
    # Удаляем только если ВСЕ 79 сгенерировались без ошибок!
    if clean_up:
        for f in wav_files:
            try: os.remove(f)
            except: pass
        print("🗑️ Мелкие файлы удалены (чистая работа).")
    else:
        print("⚠️ Оставили мелкие файлы (part_*.wav) в папке, чтобы при перезапуске продолжить без потерь.")

if __name__ == "__main__":
    generate_audiobook()