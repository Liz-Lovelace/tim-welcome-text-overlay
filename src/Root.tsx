import { Composition } from "remotion";
import { Overlay, defaultOverlayProps } from "./Overlay";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Overlay"
        component={Overlay}
        durationInFrames={1}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultOverlayProps}
      />
    </>
  );
};
