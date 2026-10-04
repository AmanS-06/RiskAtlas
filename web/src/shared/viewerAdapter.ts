// The only module that knows which 3D viewer is in use. To switch from the placeholder to the real viewer,
// change the two import paths below from '../viewer/__stub__/HeartViewerStub' to '../viewer/HeartViewer'.
import { HeartViewer } from '../viewer/__stub__/HeartViewerStub';

export { HeartViewer };
export type { Band, HeartViewerOptions, VesselId, VesselState } from '../viewer/__stub__/HeartViewerStub';
export type ViewerStatus = ReturnType<HeartViewer['getStatus']>;
