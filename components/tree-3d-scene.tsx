'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { Marriage, personName, TreeData, TreePerson } from '../lib/api';
import { API_BASE } from '../lib/api';
import { layoutTree3D, Point3 } from '../lib/tree-3d-layout';

type Props = {
  data: TreeData;
  selectedPersonId: string;
  currentPersonId?: string | null;
  canonicalRootId?: string | null;
  focusedBranchId?: string | null;
  focusRequest?: number;
  onSelect: (personId: string) => void;
  onFallback: () => void;
};

function lifeSummary(person: TreePerson) {
  const birth = person.birth_date;
  const death = !person.is_alive ? person.death_date : null;
  if (birth && death) return `${birth} – ${death}`;
  if (birth) return person.is_alive ? `Төрсөн: ${birth}` : `${birth} – ?`;
  return 'Огноо тодорхойгүй';
}

function generationLabel(generation: number) {
  return generation === 0 ? 'Төв үе' : generation < 0 ? `${Math.abs(generation)} үеийн өмнө` : `${generation} үеийн үргэлжлэл`;
}

function makeLabel(person: TreePerson, color: string, generation?: number | null): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 144;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = 'rgba(15, 38, 31, 0.88)';
    context.beginPath();
    context.roundRect(4, 4, 504, 136, 22);
    context.fill();
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = '#f5efdc';
    context.font = '600 31px Georgia, serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const name = personName(person) || 'Нэргүй хүн';
    context.fillText(name.length > 27 ? name.slice(0, 26) + '…' : name, 256, 42, 475);
    context.fillStyle = '#e3d7b3';
    context.font = '500 23px Arial, sans-serif';
    context.fillText(lifeSummary(person), 256, 83, 475);
    if (generation !== null && generation !== undefined) {
      context.fillStyle = '#dfc578';
      context.font = '600 19px Arial, sans-serif';
      context.fillText(generationLabel(generation), 256, 119, 475);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
  sprite.scale.set(7.4, 2.08, 1);
  sprite.position.y = 2.1;
  sprite.renderOrder = 20;
  return sprite;
}

function peopleInFocusedBranch(data: TreeData, branchId: string | null | undefined, selectedId: string, rootId: string | null | undefined) {
  if (!branchId) return data.persons;
  const visibleIds = new Set(data.persons
    .filter((person) => person.branch_id === branchId)
    .map((person) => person.id));
  if (rootId) visibleIds.add(rootId);
  if (selectedId) visibleIds.add(selectedId);
  // Keep one relationship ring around the branch so its parent, child, and spouse context remains legible.
  for (const edge of data.parent_child_relationships) {
    if (visibleIds.has(edge.parent_id) || visibleIds.has(edge.child_id)) {
      visibleIds.add(edge.parent_id);
      visibleIds.add(edge.child_id);
    }
  }
  for (const marriage of data.marriages) {
    if (visibleIds.has(marriage.person_1_id) || visibleIds.has(marriage.person_2_id)) {
      visibleIds.add(marriage.person_1_id);
      visibleIds.add(marriage.person_2_id);
    }
  }
  return data.persons.filter((person) => visibleIds.has(person.id));
}

export default function Tree3DScene({
  data, selectedPersonId, currentPersonId, canonicalRootId: requestedRootId, focusedBranchId, focusRequest = 0, onSelect, onFallback,
}: Props) {
  const canonicalRootId = requestedRootId && data.lineage_root_person_id === requestedRootId
    && data.persons.some((person) => person.id === requestedRootId) ? requestedRootId : null;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const labelRendererRef = useRef<CSS2DRenderer | null>(null);
  const objectsRef = useRef<THREE.Object3D[]>([]);
  const positionsRef = useRef<Map<string, Point3>>(new Map());
  const [webglError, setWebglError] = useState(false);
  const [ready, setReady] = useState(false);
  const [selectedContext, setSelectedContext] = useState('');
  const [generationChoices, setGenerationChoices] = useState<Array<{ generation: number; personId: string; count: number }>>([]);
  const hasConfirmedRoot = Boolean(
    canonicalRootId && data.persons.some((person) => person.id === canonicalRootId)
    && data.lineage_root_person_id === canonicalRootId,
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      setWebglError(true);
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(host.clientWidth, host.clientHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x102b23, 0);
    host.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(host.clientWidth, host.clientHeight);
    labelRenderer.domElement.className = 'tree-3d-html-labels';
    host.appendChild(labelRenderer.domElement);
    labelRendererRef.current = labelRenderer;

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.Fog(0x102b23, 250, 1200);
    scene.add(new THREE.HemisphereLight(0xe8dfc5, 0x203c31, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffe5a4, 2.4);
    keyLight.position.set(20, 40, 25);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb4c9b7, 0.8);
    fillLight.position.set(-30, 10, -20);
    scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(42, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 400);
    camera.position.set(28, 22, 39);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.minDistance = 9;
    controls.maxDistance = 900;
    controls.maxPolarAngle = Math.PI * 0.88;
    controls.target.set(0, 0, 0);

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    rendererRef.current = renderer;
    setReady(true);

    const resize = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      labelRenderer.setSize(host.clientWidth, host.clientHeight);
      invalidate();
    });
    resize.observe(host);

    let frame = 0;
    const render = () => {
      frame = 0;
      controls.update();
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    };
    const invalidate = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    controls.addEventListener('change', invalidate);
    invalidate();

    return () => {
      window.cancelAnimationFrame(frame);
      resize.disconnect();
      controls.removeEventListener('change', invalidate);
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
          object.geometry?.dispose?.();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelRenderer.domElement.remove();
      objectsRef.current = [];
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      rendererRef.current = null;
      labelRendererRef.current = null;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    let active = true;
    for (const object of objectsRef.current) {
      scene.remove(object);
      object.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
          child.geometry?.dispose?.();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          for (const material of materials) {
            if ('map' in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          }
        }
      });
    }

    const { positions, generations } = layoutTree3D(data);
    positionsRef.current = positions;
    if (positions.size) {
      const bounds = new THREE.Box3().setFromPoints([...positions.values()].map((point) => new THREE.Vector3(point.x, point.y, point.z)));
      const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
      if (cameraRef.current) {
        cameraRef.current.far = Math.max(400, radius * 4);
        cameraRef.current.updateProjectionMatrix();
      }
      controlsRef.current && (controlsRef.current.maxDistance = Math.max(900, radius * 2));
      if (scene.fog instanceof THREE.Fog) scene.fog.far = Math.max(180, radius * 3);
    }
    const nextObjects: THREE.Object3D[] = [];
    const visiblePeople = peopleInFocusedBranch(data, focusedBranchId, selectedPersonId, canonicalRootId);
    const personIds = new Set(visiblePeople.map((person) => person.id));
    const generationGroups = new Map<number, string[]>();
    for (const person of visiblePeople) {
      const generation = generations.get(person.id);
      if (generation === undefined || generation === null) continue;
      const rows = generationGroups.get(generation) ?? [];
      rows.push(person.id);
      generationGroups.set(generation, rows);
    }

    // The tree API exposes only an authorized, versioned photo route. Never put
    // private storage keys or raw image URLs into the scene.
    for (const person of visiblePeople.filter((item) => item.profile_photo_url).slice(0, 96)) {
      const point = positions.get(person.id);
      if (!point || !API_BASE || !person.profile_photo_url) continue;
      const url = person.profile_photo_url.startsWith('/')
        ? `${API_BASE}${person.profile_photo_url}` : person.profile_photo_url;
      void fetch(url, { credentials: person.profile_photo_url.startsWith('/') ? 'include' : 'omit', cache: 'no-store' })
        .then(async (response) => {
          if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return null;
          return createImageBitmap(await response.blob());
        })
        .then((bitmap) => {
          if (!bitmap) return;
          if (!active) { bitmap.close(); return; }
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const context = canvas.getContext('2d');
          if (!context) { bitmap.close(); return; }
          context.beginPath();
          context.arc(64, 64, 59, 0, Math.PI * 2);
          context.clip();
          const side = Math.min(bitmap.width, bitmap.height);
          context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
          bitmap.close();
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          const portrait = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
          portrait.scale.set(1.8, 1.8, 1);
          portrait.position.set(point.x, point.y + 0.15, point.z + 0.95);
          portrait.renderOrder = 19;
          portrait.userData.personId = person.id;
          if (!active) { texture.dispose(); portrait.material.dispose(); return; }
          scene.add(portrait);
          nextObjects.push(portrait);
          if (cameraRef.current) {
            rendererRef.current?.render(scene, cameraRef.current);
            labelRendererRef.current?.render(scene, cameraRef.current);
          }
        })
        .catch(() => undefined);
    }
    setGenerationChoices([...generationGroups.entries()]
      .sort(([left], [right]) => left - right)
      .map(([generation, generationPersonIds]) => ({ generation, personId: generationPersonIds[0], count: generationPersonIds.length })));
    const visibleData = {
      parent_child_relationships: data.parent_child_relationships.filter((edge) => personIds.has(edge.parent_id) && personIds.has(edge.child_id)),
      marriages: data.marriages.filter((marriage) => personIds.has(marriage.person_1_id) && personIds.has(marriage.person_2_id)),
    };
    const byId = new Map(visiblePeople.map((person) => [person.id, person]));
    const segments = (pairs: Array<[string, string]>) => {
      const coordinates: number[] = [];
      for (const [fromId, toId] of pairs) {
        const from = positions.get(fromId);
        const to = positions.get(toId);
        if (!from || !to) continue;
        coordinates.push(from.x, from.y, from.z, to.x, to.y, to.z);
      }
      if (!coordinates.length) return null;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
      return geometry;
    };
    const parentGeometry = segments(visibleData.parent_child_relationships.map((edge) => [edge.parent_id, edge.child_id]));
    if (parentGeometry) {
      const line = new THREE.LineSegments(parentGeometry, new THREE.LineBasicMaterial({ color: 0xd2bd82, transparent: true, opacity: 0.68 }));
      line.userData.relationshipType = 'parent-child';
      nextObjects.push(line);
      scene.add(line);
    }
    const currentMarriages = visibleData.marriages.filter((marriage) => marriage.status === 'married');
    const historicMarriages = visibleData.marriages.filter((marriage) => marriage.status !== 'married');
    const currentGeometry = segments(currentMarriages.map((marriage) => [marriage.person_1_id, marriage.person_2_id]));
    if (currentGeometry) {
      const line = new THREE.LineSegments(currentGeometry, new THREE.LineBasicMaterial({ color: 0xe7ca7c, transparent: true, opacity: 0.92 }));
      line.userData.relationshipType = 'current-marriage';
      nextObjects.push(line);
      scene.add(line);
    }
    const historicGeometry = segments(historicMarriages.map((marriage) => [marriage.person_1_id, marriage.person_2_id]));
    if (historicGeometry) {
      const line = new THREE.LineSegments(historicGeometry, new THREE.LineDashedMaterial({ color: 0xa99059, dashSize: 0.8, gapSize: 0.48, transparent: true, opacity: 0.72 }));
      line.computeLineDistances();
      line.userData.relationshipType = 'historic-marriage';
      nextObjects.push(line);
      scene.add(line);
    }
    const highlightedPairs: Array<[string, string]> = [];
    for (const edge of visibleData.parent_child_relationships) {
      if (edge.parent_id === selectedPersonId || edge.child_id === selectedPersonId) highlightedPairs.push([edge.parent_id, edge.child_id]);
    }
    for (const marriage of visibleData.marriages) {
      if (marriage.person_1_id === selectedPersonId || marriage.person_2_id === selectedPersonId) highlightedPairs.push([marriage.person_1_id, marriage.person_2_id]);
    }
    const highlightedGeometry = segments(highlightedPairs);
    if (highlightedGeometry) {
      const line = new THREE.LineSegments(highlightedGeometry, new THREE.LineBasicMaterial({ color: 0xffefd0, transparent: true, opacity: 0.96 }));
      line.userData.relationshipType = 'selected-person-context';
      nextObjects.push(line);
      scene.add(line);
    }

    const labeledPeople = new Set<string>([selectedPersonId, currentPersonId ?? '', canonicalRootId ?? '']);
    const selectedParents = visibleData.parent_child_relationships
      .filter((edge) => edge.child_id === selectedPersonId)
      .map((edge) => edge.parent_id);
    for (const edge of visibleData.parent_child_relationships) {
      if (edge.parent_id === selectedPersonId) labeledPeople.add(edge.child_id);
      if (edge.child_id === selectedPersonId) labeledPeople.add(edge.parent_id);
      if (selectedParents.includes(edge.parent_id)) labeledPeople.add(edge.child_id);
    }
    for (const marriage of visibleData.marriages) {
      if (marriage.person_1_id === selectedPersonId) labeledPeople.add(marriage.person_2_id);
      if (marriage.person_2_id === selectedPersonId) labeledPeople.add(marriage.person_1_id);
    }
    if (visiblePeople.length <= 48) {
      for (const person of visiblePeople) labeledPeople.add(person.id);
    }
    const labelsToShow = new Set([...labeledPeople].filter((id) => personIds.has(id)).slice(0, 72));

    const rootPeople = visiblePeople.filter((person) => person.id === canonicalRootId && positions.has(person.id));
    const regularPeople = visiblePeople.filter((person) => person.id !== canonicalRootId && positions.has(person.id));
    const addPeopleInstances = (people: TreePerson[], root: boolean) => {
      if (!people.length) return null;
      const geometry = root ? new THREE.IcosahedronGeometry(1, 1) : new THREE.SphereGeometry(1, 12, 10);
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.54, metalness: root ? 0.18 : 0.05, vertexColors: true });
      const mesh = new THREE.InstancedMesh(geometry, material, people.length);
      mesh.userData.personIds = people.map((person) => person.id);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      const color = new THREE.Color();
      people.forEach((person, index) => {
        const point = positions.get(person.id)!;
        const isSelected = person.id === selectedPersonId;
        const isCurrent = person.id === currentPersonId;
        const scale = root ? (isSelected ? 1.6 : 1.35) : (isSelected ? 1.32 : isCurrent ? 1.05 : 0.82);
        matrix.compose(new THREE.Vector3(point.x, point.y, point.z), quaternion, new THREE.Vector3(scale, scale, scale));
        mesh.setMatrixAt(index, matrix);
        color.set(root ? 0xe9ca71 : isSelected ? 0xffefd0 : isCurrent ? 0x8bb59a : 0x6e9276);
        mesh.setColorAt(index, color);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      nextObjects.push(mesh);
      return mesh;
    };
    addPeopleInstances(regularPeople, false);
    addPeopleInstances(rootPeople, true);

    const currentPerson = currentPersonId && personIds.has(currentPersonId) ? positions.get(currentPersonId) : null;
    if (currentPerson && currentPersonId !== canonicalRootId) {
      const ring = new THREE.InstancedMesh(
        new THREE.TorusGeometry(1.12, 0.07, 8, 28),
        new THREE.MeshStandardMaterial({ color: 0xb4d0b8, roughness: 0.42, metalness: 0.12 }),
        1,
      );
      ring.position.set(currentPerson.x, currentPerson.y, currentPerson.z);
      ring.rotation.x = Math.PI / 2;
      ring.userData.personIds = [currentPersonId];
      scene.add(ring);
      nextObjects.push(ring);
    }

    let labelsCreated = 0;
    for (const person of visiblePeople) {
      const point = positions.get(person.id);
      if (!point) continue;
      const isRoot = person.id === canonicalRootId;
      const isSelected = person.id === selectedPersonId;
      if (labelsToShow.has(person.id) && labelsCreated < 72) {
        const card = document.createElement('div');
        card.className = `tree-3d-world-card${isSelected ? ' tree-3d-world-card--selected' : ''}`;
        if (person.profile_photo_url) {
          const photo = document.createElement('img');
          photo.src = person.profile_photo_url.startsWith('/') ? `${API_BASE}${person.profile_photo_url}` : person.profile_photo_url;
          photo.alt = '';
          photo.loading = 'lazy';
          card.append(photo);
        }
        const name = document.createElement('strong');
        name.textContent = personName(person) || 'Нэргүй хүн';
        const dates = document.createElement('small');
        dates.textContent = lifeSummary(person);
        card.append(name, dates);
        if (hasConfirmedRoot) {
          const generation = generations.get(person.id);
          if (generation !== undefined && generation !== null) {
            const generationText = document.createElement('small');
            generationText.textContent = generationLabel(generation);
            card.append(generationText);
          }
        }
        const label = new CSS2DObject(card);
        label.position.set(point.x, point.y + 1.45, point.z);
        label.userData.personId = person.id;
        scene.add(label);
        nextObjects.push(label);
        labelsCreated += 1;
      }
    }

    const floorGeometry = new THREE.CircleGeometry(Math.max(11, Math.sqrt(visiblePeople.length) * 2), 64);
    const floor = new THREE.Mesh(floorGeometry, new THREE.MeshBasicMaterial({ color: 0x254438, transparent: true, opacity: 0.27, side: THREE.DoubleSide }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = Math.min(...[...positions.values()].map((point) => point.y)) - 3;
    scene.add(floor);
    nextObjects.push(floor);

    objectsRef.current = nextObjects;
    if (cameraRef.current) {
      rendererRef.current?.render(scene, cameraRef.current);
      labelRendererRef.current?.render(scene, cameraRef.current);
    }
    if (selectedPersonId && personIds.has(selectedPersonId)) setSelectedContext(byId.get(selectedPersonId)?.branch_name ?? '');
    return () => { active = false; };
  }, [canonicalRootId, data, focusedBranchId, selectedPersonId]);

  useEffect(() => {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const point = positionsRef.current.get(selectedPersonId);
    if (!controls || !camera || !point) return;
    const destination = new THREE.Vector3(point.x, point.y, point.z);
    const offset = camera.position.clone().sub(controls.target);
    const distance = Math.max(16, Math.min(34, offset.length()));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      controls.target.copy(destination);
      camera.position.copy(destination.clone().add(new THREE.Vector3(distance * 0.62, distance * 0.45, distance * 0.82)));
      controls.update();
      return;
    }
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const endPosition = destination.clone().add(new THREE.Vector3(distance * 0.62, distance * 0.45, distance * 0.82));
    const startAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const raw = Math.min(1, (now - startAt) / 420);
      const amount = raw * raw * (3 - 2 * raw);
      controls.target.lerpVectors(startTarget, destination, amount);
      camera.position.lerpVectors(startPosition, endPosition, amount);
      rendererRef.current?.render(sceneRef.current!, camera);
      labelRendererRef.current?.render(sceneRef.current!, camera);
      if (raw < 1) frame = window.requestAnimationFrame(animate);
      else controls.update();
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [selectedPersonId, data]);

  useEffect(() => {
    if (focusRequest) focusSelected();
  }, [focusRequest]);

  function focusSelected() {
    const point = positionsRef.current.get(selectedPersonId);
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (!point || !controls || !camera) return;
    controls.target.set(point.x, point.y, point.z);
    camera.position.set(point.x + 20, point.y + 15, point.z + 27);
    controls.update();
  }

  function focusWholeTree() {
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const visibleIds = focusedBranchId
      ? new Set(peopleInFocusedBranch(data, focusedBranchId, selectedPersonId, canonicalRootId).map((person) => person.id))
      : null;
    const points = [...positionsRef.current.entries()]
      .filter(([personId]) => !visibleIds || visibleIds.has(personId))
      .map(([, point]) => point);
    if (!controls || !camera || !points.length) return;
    const box = new THREE.Box3().setFromPoints(points.map((point) => new THREE.Vector3(point.x, point.y, point.z)));
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    // Include the portrait and label sprites in the framing, especially on a
    // narrow screen where fitting only the node centres clips the top row.
    const distance = Math.max(36, Math.min(850, (sphere.radius + 5) / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.35));
    const direction = new THREE.Vector3(0.62, 0.45, 0.82).normalize();
    controls.target.copy(center);
    camera.position.copy(center.clone().add(direction.multiplyScalar(distance)));
    camera.far = Math.max(1200, distance * 3);
    camera.updateProjectionMatrix();
    controls.update();
  }

  useEffect(() => {
    if (ready) focusWholeTree();
  }, [ready, data, focusedBranchId]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const handleClick = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, cameraRef.current!);
      const hit = raycaster.intersectObjects(objectsRef.current, false).find((item) =>
        typeof item.object.userData.personId === 'string'
        || (Number.isInteger(item.instanceId) && Array.isArray(item.object.userData.personIds)));
      const id = typeof hit?.object.userData.personId === 'string'
        ? hit.object.userData.personId
        : Number.isInteger(hit?.instanceId) ? hit?.object.userData.personIds?.[hit.instanceId!] : undefined;
      if (typeof id === 'string') onSelect(id);
    };
    renderer.domElement.addEventListener('click', handleClick);
    return () => renderer.domElement.removeEventListener('click', handleClick);
  }, [data, onSelect]);

  const selectedPerson = data.persons.find((person) => person.id === selectedPersonId);
  const selectedMarriages: Marriage[] = selectedPerson
    ? data.marriages.filter((marriage) => marriage.person_1_id === selectedPerson.id || marriage.person_2_id === selectedPerson.id)
    : [];
  const visiblePersons = peopleInFocusedBranch(data, focusedBranchId, selectedPersonId, canonicalRootId);
  const accessiblePeople = visiblePersons.slice(0, 40);
  if (selectedPerson && !accessiblePeople.some((person) => person.id === selectedPerson.id)) accessiblePeople.push(selectedPerson);
  const visibleNodeCount = visiblePersons.length;

  return (
    <section className="tree-3d-panel" aria-label="3D удмын мод">
      <div className="tree-3d-stage" role="group" aria-label={`Орон зайн удмын зураглал. ${visibleNodeCount} зөвшөөрөгдсөн хүн.`}>
        <div className="tree-3d-canvas" ref={hostRef} aria-hidden="true" />
        {!ready && !webglError && <div className="tree-3d-loading" role="status">Удмын орон зайг байгуулж байна…</div>}
        {webglError && (
          <div className="tree-3d-fallback" role="status">
            <strong>3D дүрслэл энэ төхөөрөмж дээр ажиллахгүй байна.</strong>
            <span>Одоо байгаа 2D зураглал болон харилцааны жагсаалтыг ашиглаж болно.</span>
            <button type="button" onClick={onFallback}>2D харагдац нээх</button>
          </div>
        )}
      </div>
      {!webglError && (
        <div className="tree-3d-overlay">
          <div className="tree-3d-legend" aria-label="Холбоосын тайлбар">
            <span><i className="tree-legend-parent" /> Эцэг/эх — хүүхэд</span>
            <span><i className="tree-legend-current" /> Одоогийн гэрлэлт</span>
            <span><i className="tree-legend-history" /> Түүхэн гэрлэлт</span>
            <span><i className="tree-legend-root" /> Удмын эх</span>
            <span><i className="tree-legend-self" /> Миний хүн</span>
          </div>
          <div className="tree-3d-hint">Чирж эргүүлэх · баруун товчоор зөөх · дугуйгаар томруулах</div>
          <div className="tree-3d-actions">
            <button type="button" className="tree-3d-focus" onClick={focusSelected}>Сонгосон хүнийг төвлөрүүлэх</button>
            <button type="button" className="tree-3d-focus" onClick={focusWholeTree}>Бүх модыг харах</button>
          </div>
          {hasConfirmedRoot && generationChoices.length > 1 && <div className="tree-3d-generations" aria-label="Удмын эхээс үе сонгох">
            <strong>Үе · удмын эхээс</strong>
            <div>{generationChoices.map((choice) => <button key={choice.generation} type="button" onClick={() => onSelect(choice.personId)} aria-label={`${choice.generation === 0 ? 'Төв үе' : choice.generation < 0 ? Math.abs(choice.generation) + ' үеийн өмнө' : choice.generation + ' үеийн дараа'}, ${choice.count} хүн`}>
              {choice.generation === 0 ? 'Төв үе' : choice.generation < 0 ? `${Math.abs(choice.generation)} үеийн өмнө` : `${choice.generation} үеийн дараа`} · {choice.count}
            </button>)}</div>
          </div>}
        </div>
      )}
      {selectedPerson && (
        <p className="tree-3d-context" aria-live="polite">
          {personName(selectedPerson)}{selectedContext ? ` · ${selectedContext}` : ''} · {selectedMarriages.length} гэрлэлтийн холбоос
        </p>
      )}
      <div className="tree-3d-accessible-list" aria-label="3D модны хүртээмжтэй жагсаалт">
          {accessiblePeople.map((person) => (
          <button key={person.id} type="button" aria-pressed={person.id === selectedPersonId} onClick={() => onSelect(person.id)}>
            <span className="tree-3d-person-photo" aria-hidden="true">
              {person.profile_photo_url ? <img src={person.profile_photo_url.startsWith('/') ? `${API_BASE}${person.profile_photo_url}` : person.profile_photo_url} alt="" loading="lazy" /> : (personName(person) || '?').slice(0, 1)}
            </span>
            <span className="tree-3d-person-details">
              <strong>{person.id === canonicalRootId ? 'Удмын эх · ' : ''}{person.id === currentPersonId ? 'Миний хүн · ' : ''}{personName(person)}</strong>
              <small>{lifeSummary(person)}</small>
            </span>
          </button>
        ))}
      </div>
      {visiblePersons.length > 40 && <p className="tree-3d-limit" role="status">Хүртээмжтэй жагсаалтад эхний 40 хүнийг үзүүлж байна. Бусдыг дээд талын хайлтаар олж сонгоно уу.</p>}
      {data.meta?.truncated && <p className="tree-3d-limit" role="status">Одоогийн фокусын хүрээнд {visibleNodeCount} хүнийг дүрсэллээ. Бусад хүнийг хайж сонгоход тухайн хүний зөвшөөрөгдсөн холбоосыг ачаална.</p>}
    </section>
  );
}
