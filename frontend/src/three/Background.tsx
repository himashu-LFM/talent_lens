import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Float, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, Vignette } from "@react-three/postprocessing";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const YELLOW = "#F5C518";
const N_BLADES = 7;

/** Gentle camera parallax toward the pointer. */
function ParallaxRig() {
  const { camera, pointer } = useThree();
  useFrame(() => {
    camera.position.x += (pointer.x * 0.8 - camera.position.x) * 0.035;
    camera.position.y += (pointer.y * 0.5 - camera.position.y) * 0.035;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

/** A camera-aperture / iris that slowly rotates and "breathes" open and closed,
 *  echoing the ListenFirst shutter mark. Dark metal blades over a glowing core. */
function Aperture() {
  const group = useRef<THREE.Group>(null!);
  const blades = useRef<THREE.Mesh[]>([]);

  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0, -0.14);
    s.lineTo(2.5, -0.62);
    s.quadraticCurveTo(3.0, 0, 2.5, 0.62);
    s.lineTo(0, 0.14);
    s.quadraticCurveTo(-0.18, 0, 0, -0.14);
    return new THREE.ExtrudeGeometry(s, {
      depth: 0.14,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
  }, []);

  useFrame((state, d) => {
    group.current.rotation.z += d * 0.12;
    const breathe = (Math.sin(state.clock.elapsedTime * 0.45) + 1) / 2; // 0..1
    const open = 0.5 + breathe * 0.35;
    blades.current.forEach((m) => {
      if (m) m.rotation.z = Math.PI * open;
    });
  });

  return (
    <group ref={group} rotation={[0.35, 0, 0]}>
      {/* glowing core seen through the iris */}
      <mesh position={[0, 0, -0.35]}>
        <circleGeometry args={[1.35, 64]} />
        <meshStandardMaterial
          color={YELLOW}
          emissive={YELLOW}
          emissiveIntensity={2.6}
          toneMapped={false}
        />
      </mesh>
      {/* thin yellow rim ring */}
      <mesh position={[0, 0, -0.36]}>
        <ringGeometry args={[2.35, 2.5, 64]} />
        <meshStandardMaterial
          color={YELLOW}
          emissive={YELLOW}
          emissiveIntensity={1.8}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {Array.from({ length: N_BLADES }).map((_, i) => (
        <group key={i} rotation={[0, 0, (i / N_BLADES) * Math.PI * 2]}>
          <mesh
            ref={(el) => {
              if (el) blades.current[i] = el;
            }}
            geometry={geo}
            position={[1.15, 0, i * 0.012]}
          >
            <meshStandardMaterial
              color="#0b0b0d"
              metalness={0.95}
              roughness={0.32}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Warm, faint drifting dust. */
function Dust({ count = 700 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null!);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 5 + Math.random() * 13;
      const t = Math.random() * Math.PI * 2;
      const p = Math.acos(2 * Math.random() - 1);
      arr[i * 3] = r * Math.sin(p) * Math.cos(t);
      arr[i * 3 + 1] = r * Math.sin(p) * Math.sin(t) * 0.55;
      arr[i * 3 + 2] = r * Math.cos(p);
    }
    return arr;
  }, [count]);
  useFrame((_, d) => {
    ref.current.rotation.y += d * 0.012;
  });
  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.022}
        color="#d8d2b8"
        transparent
        opacity={0.5}
        sizeAttenuation
      />
    </points>
  );
}

export default function Background() {
  return (
    <div className="bg-canvas">
      <Canvas
        camera={{ position: [0, 0, 7], fov: 52 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <color attach="background" args={["#08080a"]} />
        <fog attach="fog" args={["#08080a", 10, 24]} />
        <ambientLight intensity={0.25} />
        {/* warm gold key + white rim */}
        <spotLight
          position={[5, 6, 8]}
          angle={0.5}
          intensity={140}
          color="#fff3cf"
          penumbra={1}
        />
        <pointLight position={[-6, -3, 2]} intensity={40} color={YELLOW} />
        <pointLight position={[0, 2, -6]} intensity={30} color="#ffffff" />

        <ParallaxRig />
        <Dust />
        <Float speed={1} rotationIntensity={0.2} floatIntensity={0.6}>
          <Aperture />
        </Float>
        <Sparkles
          count={50}
          scale={11}
          size={2}
          speed={0.3}
          color="#f5e6b0"
          opacity={0.5}
        />

        <Environment preset="night" />

        <EffectComposer>
          <Bloom
            intensity={1.1}
            luminanceThreshold={0.55}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.28} darkness={0.92} />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
