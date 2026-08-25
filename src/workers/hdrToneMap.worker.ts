/* eslint-disable @typescript-eslint/no-explicit-any */

interface InitMessage {
  type: 'init'
  width: number
  height: number
  transfer: 'pq' | 'hlg'
}

interface FrameMessage {
  type: 'frame'
  frame: VideoFrame
}

interface CloseMessage {
  type: 'close'
}

type IncomingMessage = InitMessage | FrameMessage | CloseMessage

interface WorkerScope {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

const scope = globalThis as unknown as WorkerScope
let device: any = null
let context: any = null
let pipeline: any = null
let sampler: any = null
let uniformBuffer: any = null
let canvas: OffscreenCanvas | null = null
let transferMode: 'pq' | 'hlg' = 'pq'
let workerClosed = false

const shader = `
struct Uniforms { transfer_mode: u32, width: f32, height: f32, _pad: f32 }
@group(0) @binding(0) var source_texture: texture_external;
@group(0) @binding(1) var source_sampler: sampler;
@group(0) @binding(2) var<uniform> uniforms: Uniforms;

fn pq_to_linear(v: vec3f) -> vec3f {
  let m1 = 2610.0 / 16384.0;
  let m2 = 2523.0 / 32.0;
  let c1 = 3424.0 / 4096.0;
  let c2 = 2413.0 / 128.0;
  let c3 = 2392.0 / 128.0;
  let p = pow(max(v, vec3f(0.0)), vec3f(1.0 / m2));
  return pow(max(p - vec3f(c1), vec3f(0.0)) / max(vec3f(c2) - vec3f(c3) * p, vec3f(0.0000001)), vec3f(1.0 / m1));
}

fn hlg_to_linear(v: vec3f) -> vec3f {
  let a = 0.17883277;
  let b = 0.28466892;
  let c = 0.55991073;
  let low = v * v / 3.0;
  let high = (exp((v - vec3f(c)) / a) + vec3f(b)) / 12.0;
  return select(high, low, v <= vec3f(0.5));
}

fn rec2020_to_rec709(v: vec3f) -> vec3f {
  return vec3f(
    1.660491 * v.r - 0.587641 * v.g - 0.072850 * v.b,
   -0.124550 * v.r + 1.132900 * v.g - 0.008349 * v.b,
   -0.018151 * v.r - 0.100579 * v.g + 1.118730 * v.b
  );
}

fn sdr_oetf(v: vec3f) -> vec3f {
  let low = v * 12.92;
  let high = 1.055 * pow(max(v, vec3f(0.0)), vec3f(1.0 / 2.4)) - 0.055;
  return select(high, low, v <= vec3f(0.0031308));
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}

@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}

@fragment fn fragment_main(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let uv = vec2f(position.x / uniforms.width, 1.0 - position.y / uniforms.height);
  let encoded = textureSampleBaseClampToEdge(source_texture, source_sampler, uv).rgb;
  let linear2020 = select(hlg_to_linear(encoded), pq_to_linear(encoded), uniforms.transfer_mode == 0u);
  let linear709 = max(rec2020_to_rec709(linear2020 * 100.0), vec3f(0.0));
  let shoulder = linear709 / (vec3f(1.0) + linear709);
  let dither = (hash(position.xy) - 0.5) / 255.0;
  return vec4f(clamp(sdr_oetf(shoulder) + vec3f(dither), vec3f(0.0), vec3f(1.0)), 1.0);
}
`

async function initialize(message: InitMessage) {
  const gpu = (navigator as Navigator & { gpu?: any }).gpu
  if (!gpu) throw new Error('WebGPU is unavailable')
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' })
  if (!adapter) throw new Error('WebGPU adapter is unavailable')
  device = await adapter.requestDevice()
  canvas = new OffscreenCanvas(message.width, message.height)
  context = (canvas as any).getContext('webgpu')
  if (!context) throw new Error('WebGPU canvas context is unavailable')
  const format = gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: 'opaque', colorSpace: 'srgb' })
  pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: device.createShaderModule({ code: shader }), entryPoint: 'vertex_main' },
    fragment: { module: device.createShaderModule({ code: shader }), entryPoint: 'fragment_main', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' })
  uniformBuffer = device.createBuffer({ size: 16, usage: 0x40 | 0x08 })
  transferMode = message.transfer
  device.lost.then(() => {
    if (!workerClosed) scope.postMessage({ type: 'error', reason: 'WebGPU device was lost' })
  })
  scope.postMessage({ type: 'ready' })
}

async function processFrame(frame: VideoFrame) {
  if (!device || !context || !pipeline || !canvas) throw new Error('Tone mapper is not initialized')
  const externalTexture = device.importExternalTexture({ source: frame, colorSpace: 'rec2020' })
  const uniform = new ArrayBuffer(16)
  new Uint32Array(uniform, 0, 1)[0] = transferMode === 'hlg' ? 1 : 0
  const floats = new Float32Array(uniform)
  floats[1] = canvas.width
  floats[2] = canvas.height
  device.queue.writeBuffer(uniformBuffer, 0, uniform)
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: externalTexture },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: uniformBuffer } },
    ],
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  })
  pass.setPipeline(pipeline)
  pass.setBindGroup(0, bindGroup)
  pass.draw(3)
  pass.end()
  device.queue.submit([encoder.finish()])
  await device.queue.onSubmittedWorkDone()
  const output = new VideoFrame(canvas, {
    timestamp: frame.timestamp,
    duration: frame.duration ?? undefined,
    alpha: 'discard',
  })
  frame.close()
  scope.postMessage({ type: 'frame', frame: output }, [output])
}

scope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'close') {
    workerClosed = true
    device?.destroy()
    return
  }
  const operation = message.type === 'init' ? initialize(message) : processFrame(message.frame)
  void operation.catch((error: unknown) => {
    if (message.type === 'frame') message.frame.close()
    scope.postMessage({ type: 'error', reason: error instanceof Error ? error.message : 'HDR tone mapping failed' })
  })
}
