# Fast encrypted voice entry / Быстрый вход в E2EE

This change is frontend-only. It needs neither a backend/deploy release nor a
database migration. It does not change the audio frame format or v2 wrapped
sender-key format. No version is released by the feature branch.

## What changes

1. The first confirmed room snapshot distributes the joining call's freshly
   generated key immediately. Distribution never reinstalls the outgoing key,
   which would reset its frame counter. An already confirmed empty room uses a
   **new** key when another member arrives: its earlier solo audio remains private.
2. Later rotations activate after every intended recipient confirms worker key
   installation. A receiver ACKs after the worker RPC succeeds, not merely after
   posting the key to the worker. A one-second deadline permits older clients,
   dropped ACKs and a stalled recipient without blocking the room indefinitely.
3. Selecting an encrypted voice channel can warm one worker, read/create an
   in-memory device identity and fetch public keys. Preparation is scoped to the
   API object, token, user and room, expires after 30 seconds and is released on
   scope changes. It does not register a device or persist identity/trust records.
   Actual joins still revalidate/register the device, and microphone capture,
   ICE lookup and encryption preparation run concurrently.

Canceling a join also closes a consumed worker while registration or capture is
still pending; it cannot leave an unowned call worker running in the background.

The first missing-key request is immediate; retries remain limited to one per
sender every two seconds. Eager requests never receive an earlier audience's
audio key. At most 32 early messages wait for a membership snapshot.

## Readiness protocol and compatibility

The v2 key envelope optionally carries `ready_nonce`, a random 16-byte challenge.
Its existing ciphertext/AAD remain unchanged so older clients can decrypt it.
Only an envelope requesting readiness produces an ACK; new clients therefore
do not send unknown control messages to old senders.

ACKs travel through the existing opaque `e2ee.key` relay as base64 JSON with
`type: key-installed`. Their AES-GCM authentication uses the devices' pairwise
ECDH key under a separate HKDF purpose. Authenticated data binds the original
room, both devices, key slot, generation and challenge. A third room member
cannot ACK for another recipient. The sender accepts only its current challenge
from an allowed, still-present recipient. A changed/stripped challenge can force
the bounded fallback, but cannot forge a successful ACK or expose an audio key.

Duplicate key delivery waits for the same installation and can resend an ACK
without reinstalling the key or resetting its replay window. A timed-out worker
command is terminal: retrying an ambiguously applied command in that worker
could reset cryptographic state. Late replies and abandoned generations are ignored.

The 100 ms membership gather window replaces the old one-second window. The
two-second minimum interval between **rotations** and ten-second receive-key
retention remain intact to protect the eight frame key slots. Bootstrap delivery
does not rotate. Under rapid membership churn, a later rotation can still wait
for this limit. Older peers retain their original onboarding behavior and use
the readiness deadline when they do not implement ACKs.

## Measurement and verification

The browser fixture uses the real `BrowserVoiceSession`, worker, WebCrypto and
sender-key exchange. The synthetic relay adds 25 ms in each direction. Two
cases cover simultaneous entry and a newcomer entering an already confirmed
empty room. Keys are not preinstalled in these cases.

Initial local Yandex Browser 26.10 measurements:

| Entry | Transform | First decrypted frame | First audible tone |
| --- | --- | ---: | ---: |
| Simultaneous | Script | 31 ms | 136 ms |
| Newcomer | Script | 172 ms | 285 ms |
| Simultaneous | Streams | 33 ms | 141 ms |
| Newcomer | Streams | 171 ms | 274 ms |

These are local fixture measurements, not Selectel/WAN guarantees. Browser
scheduling, ICE, capture permissions and real network conditions add their own
latency. CI uses generous bounds below the former fixed two-to-three-second wait.
Existing tests still check normal audio and silence with absent/incorrect keys.
Unit coverage checks authenticated ACKs, worker ordering/failures, duplicate
delivery, departures, burst membership, legacy/lost ACKs, preparation expiry,
scope changes and revoked devices.

Diagnostic events `e2ee_key_sent`, `e2ee_key_installed`, `e2ee_send_key_active`,
`e2ee_first_send_frame` and `e2ee_first_recv_frame` record elapsed milliseconds
once per call stage. They contain no keys, frame contents or ACK challenges.

## Кратко по-русски

При обычном входе устранены фиксированные ожидания раздачи и включения ключа.
Первый ключ отправляется после `voice.joined`; новый ключ ротации включается по
подтверждению, что получатель уже установил его в worker. Тайм-аут для старых или
медленных клиентов остаётся ограниченным. Участник не получает ключ, которым
шифровался звук до его входа. Ограничения частоты ротаций сохраняются, поэтому
при частых изменениях состава комнаты задержка может быть больше обычной.

Предварительная подготовка не сохраняет новый приватный ключ и не регистрирует
устройство до реального подключения. При входе регистрация проверяется заново,
в том числе после отзыва устройства. Бэкенд, деплой и формат аудио не меняются.
