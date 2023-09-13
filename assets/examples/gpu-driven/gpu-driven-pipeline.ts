import {
    _decorator,
    Component,
    gfx,
    renderer,
    rendering,
} from 'cc';
import { getWindowInfo, WindowInfo } from '../pipeline-data';
const { ccclass } = _decorator;

class GPUDrivenPipeline implements rendering.PipelineBuilder {
    // interface
    public setup (cameras: renderer.scene.Camera[], ppl: rendering.BasicPipeline): void {
        this._gpuDrivenEnabled = (ppl as rendering.Pipeline).isGPUDrivenEnabled;
        for (let i = 0; i < cameras.length; i++) {
            const camera = cameras[i];
            if (camera.scene === null || camera.window === null) {
                continue;
            }
            const info = this.prepareCameraResources(ppl, camera);
            this.buildForward(ppl, camera, info.id, info.width, info.height);
        }
        this._cullingID = 0;
    }
    private prepareCameraResources (
        ppl: rendering.BasicPipeline,
        camera: renderer.scene.Camera): WindowInfo {
        const info = getWindowInfo(camera);
        if (info.width === 0 && info.height === 0) {
            info.width = camera.window.width;
            info.height = camera.window.height;
            this.initCameraResources(ppl, camera, info.id, info.width, info.height);
        } else if (
            info.framebuffer !== camera.window.framebuffer ||
            info.width !== camera.window.width ||
            info.height !== camera.window.height) {
            info.framebuffer = camera.window.framebuffer;
            info.width = camera.window.width;
            info.height = camera.window.height;
            this.updateCameraResources(ppl, camera, info.id, info.width, info.height);
        }
        return info;
    }
    private initCameraResources (ppl: rendering.BasicPipeline, camera: renderer.scene.Camera, id: number, width: number, height: number): void {
        ppl.addRenderWindow(`Color${id}`, gfx.Format.BGRA8, width, height, camera.window);
        ppl.addDepthStencil(`DepthStencil${id}`, gfx.Format.DEPTH_STENCIL, width, height, rendering.ResourceResidency.PERSISTENT);
    }
    private updateCameraResources (ppl: rendering.BasicPipeline, camera: renderer.scene.Camera, id: number, width: number, height: number): void {
        ppl.updateRenderWindow(`Color${id}`, camera.window);
        ppl.updateDepthStencil(`DepthStencil${id}`, width, height);
    }

    private addForwardPass(ppl: rendering.Pipeline,
        camera: renderer.scene.Camera,
        id: number,
        width: number,
        height: number): void {
            const pass = ppl.addRenderPass(width, height, 'default');
            pass.setViewport(this._viewport);
            if (camera.clearFlag & gfx.ClearFlagBit.COLOR) {
                pass.addRenderTarget(`Color${id}`, gfx.LoadOp.CLEAR, gfx.StoreOp.STORE, this._clearColor);
        } else if (camera.clearFlag & renderer.scene.SKYBOX_FLAG) {
            pass.addRenderTarget(`Color${id}`, gfx.LoadOp.DISCARD);
            } else {
                pass.addRenderTarget(`Color${id}`, gfx.LoadOp.LOAD);
            }
            if (camera.clearFlag & gfx.ClearFlagBit.DEPTH_STENCIL) {
                pass.addDepthStencil(
                    this._depthStencil,
                    gfx.LoadOp.CLEAR,
                    gfx.StoreOp.STORE,
                    camera.clearDepth,
                    camera.clearStencil,
                    camera.clearFlag & gfx.ClearFlagBit.DEPTH_STENCIL);
            } else {
                pass.addDepthStencil(this._depthStencil, gfx.LoadOp.LOAD);
            }
            pass.addQueue(rendering.QueueHint.NONE)
                .addSceneOfCamera(
                    camera,
                    new rendering.LightInfo(),
                    rendering.SceneFlags.OPAQUE | rendering.SceneFlags.MASK);
            pass.addQueue(rendering.QueueHint.BLEND)
                .addSceneOfCamera(
                    camera,
                    new rendering.LightInfo(),
                    rendering.SceneFlags.BLEND);
            pass.showStatistics = true;
        }

    /**
     *  1, Two pass occlusion culling:
     *  compute
     *  render gpu opaque
     *  render old opaque
     *  hiz generation
     *  
     *  compute
     *  render gpu opaque
     *  render gpu transparent
     *  render old transparent
     *  hiz generation
     *  
     *  2, No occlusion culling:
     *  compute
     *  render gpu opaque
     *  render old opaque
     *  render gpu transparent
     *  render old transparent
     */
    private addGPUDrivenPass(ppl: rendering.Pipeline,
        cullingID: number,
        camera: renderer.scene.Camera,
        id: number,
        width: number,
        height: number, 
        layoutPath: string): void {
        
        const hzbName = 'HiZBuffer';
        const passCount = hzbName.length > 0 ? 2 : 1;
        for (let passIndex = 0; passIndex < passCount; passIndex++) {
            const bMainPass = (passIndex == 0);

            ppl.addBuiltinGpuCullingPass(cullingID, camera, layoutPath, hzbName, null, bMainPass);

            const pass = ppl.addRenderPass(width, height, 'default');
            pass.setViewport(this._viewport);
            if (camera.clearFlag & gfx.ClearFlagBit.COLOR) {
                pass.addRenderTarget(`Color${id}`, gfx.LoadOp.CLEAR, gfx.StoreOp.STORE, this._clearColor);
            } else if (camera.clearFlag & renderer.scene.SKYBOX_FLAG) {
                pass.addRenderTarget(`Color${id}`, bMainPass ? gfx.LoadOp.DISCARD : gfx.LoadOp.LOAD);
            } else {
                pass.addRenderTarget(`Color${id}`, gfx.LoadOp.LOAD);
            }
            if (camera.clearFlag & gfx.ClearFlagBit.DEPTH_STENCIL) {
                pass.addDepthStencil(
                    this._depthStencil,
                    bMainPass ? gfx.LoadOp.CLEAR : gfx.LoadOp.LOAD,
                    gfx.StoreOp.STORE,
                    camera.clearDepth,
                    camera.clearStencil,
                    camera.clearFlag & gfx.ClearFlagBit.DEPTH_STENCIL);
            } else {
                pass.addDepthStencil(this._depthStencil, gfx.LoadOp.LOAD);
            }

            if (bMainPass) {
                pass.addQueue(rendering.QueueHint.NONE)
                    .addSceneOfCamera(
                        camera,
                        new rendering.LightInfo(),
                        rendering.SceneFlags.OPAQUE | rendering.SceneFlags.MASK);
            }

            pass.addQueue(rendering.QueueHint.NONE)
                .addSceneOfCamera(
                    camera,
                    new rendering.LightInfo(),
                    rendering.SceneFlags.OPAQUE | rendering.SceneFlags.MASK | rendering.SceneFlags.GPU_DRIVEN, cullingID);

            pass.addQueue(rendering.QueueHint.BLEND)
                .addSceneOfCamera(
                    camera,
                    new rendering.LightInfo(),
                    rendering.SceneFlags.BLEND | rendering.SceneFlags.GPU_DRIVEN, cullingID);
            
            if (!bMainPass) {
                pass.addQueue(rendering.QueueHint.BLEND)
                    .addSceneOfCamera(
                        camera,
                        new rendering.LightInfo(),
                        rendering.SceneFlags.BLEND);
                pass.showStatistics = true;
            }

            const targetHzbName = hzbName + String(cullingID);
            ppl.addBuiltinHzbGenerationPass(this._depthStencil, targetHzbName);
        }
    }

    private buildForward (
        ppl: rendering.BasicPipeline,
        camera: renderer.scene.Camera,
        id: number,
        width: number,
        height: number): void {
        this._depthStencil = `DepthStencil${id}`;
        // Camera
        this._clearColor.x = camera.clearColor.x;
        this._clearColor.y = camera.clearColor.y;
        this._clearColor.z = camera.clearColor.z;
        this._clearColor.w = camera.clearColor.w;

        // Viewport
        this._viewport.left = camera.viewport.x * width;
        this._viewport.top = camera.viewport.y * height;
        this._viewport.width = camera.viewport.z * width;
        this._viewport.height = camera.viewport.w * height;

        if (this._gpuDrivenEnabled) {
            this.addGPUDrivenPass(ppl as rendering.Pipeline, this._cullingID, camera, id, width, height, 'default/default');
            this._cullingID++;
        } else {
            this.addForwardPass(ppl as rendering.Pipeline, camera, id, width, height);
        }
    }

    readonly _clearColor = new gfx.Color(0, 0, 0, 1);
    readonly _viewport = new gfx.Viewport();
    private _depthStencil = '';
    private _gpuDrivenEnabled = false;
    private _cullingID = 0;
}

rendering.setCustomPipeline('GPUDrivenPipeline', new GPUDrivenPipeline());

@ccclass('GPUDrivenPipelineComp')
export class GPUDrivenPipelineComp extends Component {
    start() {
        // noop
    }

    update(deltaTime: number) {
        // noop
    }
}
