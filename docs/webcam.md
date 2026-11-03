# Webcams / Вебкамеры

In a voice channel or conversation call, enable the camera from call controls,
choose Low (360p/15 FPS), Medium (720p/24 FPS), or High (1080p/30 FPS), then grant
browser access. Video replaces your participant card and your name remains
underneath. Click the video to expand it, enter fullscreen, or use Picture in
Picture. The selected format is bounded by device/browser capabilities.

The active camera's quality button changes capture resolution and encoder
limits in place. Microphone mute, deafen and screen sharing stay independent.
Stopping video restores the participant card. Leaving or switching calls closes
the physical camera; cancelling a pending permission result also stops any
late-granted capture. The chosen preset is saved locally.

Voice channels use one VP8 camera track per participant through the voice SFU,
with SDP `camera-<connection_id>` ownership labels. Conversation calls identify
camera streams separately from screen streams with scoped call media metadata
and a shared monotonic revision. They support simultaneous camera and screen,
late participants and repeated camera start. No screen publisher slot is used.

Webcams use WebRTC transport encryption. Like screen video, they are outside
the voice end-to-end encryption scheme; encrypted rooms/calls display this.

Камера работает в голосовых каналах и личных звонках и появляется **вместо
карточки** участника. Под видео остаётся имя. Нажмите на видео для раскрытия,
полного экрана или картинки в картинке. Перед включением доступны три пресета:
низкое 360p/15 FPS, среднее 720p/24 FPS и высокое 1080p/30 FPS. Качество можно
менять во время разговора, без повторного подключения. Камера, показ экрана
и микрофон работают независимо. Выключение камеры возвращает карточку, выход
или отмена включения освобождают устройство. Видео шифруется WebRTC, но не
использует сквозное шифрование голоса.

Checks cover capture cancellation/device end, live constraints, SFU sender
selection and SDP ownership, card replacement, call lease metadata, real
Chromium decoding with camera plus screen, quality changes and camera restart.
