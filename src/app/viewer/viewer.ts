import {
  Component, ElementRef, EventEmitter, ViewChild,
  AfterViewInit, Inject, PLATFORM_ID, Output, Input,
  OnDestroy, SimpleChanges
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { ProjectModel } from '../models/project.model';
import { AssetStorageService } from '../services/asset-storage.service';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { DragControls } from 'three/examples/jsm/controls/DragControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

@Component({
  selector: 'app-viewer',
  standalone: true,
  templateUrl: './viewer.html',
  styleUrl: './viewer.css',
})
export class ViewerComponent implements AfterViewInit, OnDestroy {

  @Input() project!: ProjectModel;
  @Input() workspaceMode: 'simulation' | 'editor' = 'simulation';
  @Input() interactionMode: 'guided' | 'drag-drop' = 'guided';
  @Input() editorTransformMode: 'translate' | 'rotate' | 'scale' = 'translate';
  @Input() assemblyRotationEnabled = false;
  @Output() meshClicked = new EventEmitter<string>();
  @Output() componentAssembled = new EventEmitter<string>();
  @Output() componentDisassembled = new EventEmitter<string>();
  @Output() assemblyExploded = new EventEmitter<void>();
  @ViewChild('canvas') canvasRef!: ElementRef;

  isStlMode = false;
  isAutoAssembling = false;
  isFullyAssembled = false;
  isExploded = true;
  autoAssemblyProgress = '';
  private isBrowser: boolean;

  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  controls!: OrbitControls;
  dragControls!: DragControls;
  transformControls!: TransformControls;
  assemblyContainer!: THREE.Group;
  assembledGroup!: THREE.Group;

  meshMap: { [key: string]: THREE.Object3D } = {};
  slotMap: { [key: string]: THREE.Mesh } = {};
  interactiveMeshes: THREE.Object3D[] = [];

  stackOffset = { x: 3, y: -1.5 };

  private stlLoadedCount = 0;
  private stlTotal = 0;
  private stlReady = false;
  private currentStep = 0;
  private movingComponentId: string | null = null;
  private viewReady = false;
  private isRotatingAssembly = false;
  private isExploding = false;
  private lastRotationPointer = { x: 0, y: 0 };
  private selectedObject: THREE.Object3D | null = null;
  private selectedOriginalEmissive = new Map<THREE.Material, number>();
  private snapThreshold = 0.85;
  private targetGhosts: THREE.Mesh[] = [];
  private readonly assemblyTargets: { [key: string]: THREE.Vector3 } = {
    'part-1': new THREE.Vector3(3, -3, 0),
    'part-2': new THREE.Vector3(3, -2.2, 0),
    'part-3': new THREE.Vector3(3, -2.0, 0),
    'part-4': new THREE.Vector3(3, -1.2, 0),
    'part-5': new THREE.Vector3(3, -0.5, 0),
  };

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  loader = new STLLoader();
  gltfLoader = new GLTFLoader();

  constructor(
    @Inject(PLATFORM_ID) platformId: Object,
    private assetStorage: AssetStorageService
  ) {
    this.isBrowser = isPlatformBrowser(platformId);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.project) return;
    this.isStlMode = this.project.models?.length > 0;

    if (
      this.viewReady &&
      (changes['interactionMode'] || changes['project'] || changes['workspaceMode'])
    ) {
      this.resetScene();
    } else if (changes['editorTransformMode']) {
      this.transformControls?.setMode(this.editorTransformMode);
    } else if (changes['assemblyRotationEnabled']) {
      if (!this.assemblyRotationEnabled) {
        this.resetAssemblyInspectionRotation();
      }
      this.updateDragControlsEnabled();
      this.updateOrbitControlsForMode();
    }
  }

  ngAfterViewInit(): void {
    if (!this.isBrowser) return;

    this.canvasRef.nativeElement.addEventListener('click', (event: MouseEvent) => {
      this.onCanvasClick(event);
    });
    this.canvasRef.nativeElement.addEventListener('pointerdown', (event: PointerEvent) => {
      this.onAssemblyRotatePointerDown(event);
    });
    window.addEventListener('pointermove', (event: PointerEvent) => {
      this.onAssemblyRotatePointerMove(event);
    });
    window.addEventListener('pointerup', () => {
      this.onAssemblyRotatePointerUp();
    });

    this.initScene();
    this.animate();
    this.viewReady = true;
  }

  ngOnDestroy(): void {
    this.disposeDragControls();
    this.disposeTransformControls();
    this.controls?.dispose();
    this.renderer?.dispose();
  }

  initScene() {
    const width = this.canvasRef.nativeElement.clientWidth || window.innerWidth;
    const height = this.canvasRef.nativeElement.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050816');
    this.assemblyContainer = new THREE.Group();
    this.assemblyContainer.name = 'assemblyContainer';
    this.scene.add(this.assemblyContainer);

    this.assembledGroup = new THREE.Group();
    this.assembledGroup.name = 'assembledGroup';
    this.scene.add(this.assembledGroup);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 6;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true,
    });

    this.renderer.setSize(width, height);
    this.setupOrbitControls();
    this.setupTransformControls();

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(2, 2, 5);
    this.scene.add(light);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    if (this.isStlMode) {
      this.loadProjectModels();
    } else {
      this.loadCubeSimulation();
    }
  }

  animate() {
    requestAnimationFrame(() => this.animate());

    Object.values(this.meshMap).forEach(mesh => {
      const target = mesh.userData['targetPosition'];

      if (target) {
        mesh.position.x += (target.x - mesh.position.x) * 0.08;
        mesh.position.y += (target.y - mesh.position.y) * 0.08;
        mesh.position.z += (target.z - mesh.position.z) * 0.08;

        const distance =
          Math.abs(target.x - mesh.position.x) +
          Math.abs(target.y - mesh.position.y) +
          Math.abs(target.z - mesh.position.z);

        if (distance < 0.01) {
          mesh.position.set(target.x, target.y, target.z);
          mesh.userData['targetPosition'] = null;
          const onArrival = mesh.userData['onArrival'];
          mesh.userData['onArrival'] = null;

          if (typeof onArrival === 'function') {
            onArrival();
          }
        }
      }
    });

    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  loadSTL(model: any, index: number) {
    if (!this.isStlMode) return;

    const modelUrl = this.getModelFileUrl(model.file);
    const fileType = this.getModelFileType(model);

    if (fileType === 'glb') {
      this.loadGLB(model, index, modelUrl);
      return;
    }

    this.loader.load(modelUrl, (geometry) => {
      geometry.center();

      const material = new THREE.MeshStandardMaterial({ color: 0xbdbdbd });
      const mesh = new THREE.Mesh(geometry, material);

      const explodedRotation = model.explodedRotation || model.rotation || [-Math.PI / 2, 0, 0];

      mesh.rotation.x = explodedRotation[0] ?? -Math.PI / 2;
      mesh.rotation.y = explodedRotation[1] ?? 0;
      mesh.rotation.z = explodedRotation[2] ?? 0;
      this.registerLoadedModel(model, index, mesh);
    });
  }

  loadProjectModels() {
    this.stlTotal = this.project.models.length;
    this.stlLoadedCount = 0;
    this.stlReady = false;
    this.currentStep = 0;
    this.movingComponentId = null;
    this.setAssemblyState();
    this.createAssemblyTargetGhosts();

    if (this.project.sourceType === 'glb-scene' && this.project.sourceFile) {
      this.loadSceneDrivenGLB();
      return;
    }

    this.project?.models?.forEach((m, i) => this.loadSTL(m, i));
  }

  private async loadSceneDrivenGLB() {
    const sourceUrl = await this.assetStorage.resolveAssetUrl(this.project.sourceFile!);

    this.gltfLoader.load(sourceUrl, (gltf) => {
      const meshByPath = new Map<string, THREE.Mesh>();

      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          meshByPath.set(this.getHierarchyPath(child), child as THREE.Mesh);
        }
      });

      this.project.models.forEach((model, index) => {
        const sourceMesh = meshByPath.get(model.hierarchyPath || '') ||
          Array.from(meshByPath.values())[index];

        if (!sourceMesh) {
          this.completeModelLoad();
          return;
        }

        const mesh = sourceMesh.clone();
        mesh.geometry = sourceMesh.geometry;

        if (Array.isArray(sourceMesh.material)) {
          mesh.material = sourceMesh.material.map(material => material.clone());
        } else {
          mesh.material = sourceMesh.material.clone();
        }

        const initialPosition = this.isEditorMode()
          ? model.originalPosition || model.targetPosition || [0, 0, 0]
          : model.explodedPosition || model.initialPosition || [0, 0, 0];
        const assemblyRotation = model.originalRotation || model.rotation || [0, 0, 0];
        const explodedRotation = model.explodedRotation || assemblyRotation;
        const scale = model.originalScale || [model.scale || 1, model.scale || 1, model.scale || 1];

        mesh.position.set(initialPosition[0], initialPosition[1], initialPosition[2]);
        mesh.rotation.set(explodedRotation[0], explodedRotation[1], explodedRotation[2]);
        mesh.scale.set(scale[0], scale[1], scale[2]);

        this.registerSceneDrivenPart(model, mesh);
      });
    });
  }

  private registerSceneDrivenPart(model: any, object: THREE.Object3D) {
    object.updateMatrixWorld(true);
    object.userData['componentId'] = model.id;
    object.userData['assembled'] = false;
    object.userData['isMoving'] = false;
    object.userData['isDragging'] = false;
    object.userData['locked'] = false;
    object.userData['targetPosition'] = null;
    object.userData['finalPosition'] = model.originalPosition || model.targetPosition;
    object.userData['originalPosition'] = new THREE.Vector3(
      ...(model.explodedPosition || model.initialPosition || [0, 0, 0])
    );
    object.userData['explodedRotation'] = object.rotation.clone();
    object.userData['assembledPosition'] = null;
    object.userData['dragRejectedOnStart'] = false;
    object.userData['rotationSpeed'] = 0.001 + Math.random() * 0.002;

    this.assemblyContainer.add(object);
    this.meshMap[model.id] = object;
    this.interactiveMeshes.push(object);
    this.markPartChildren(object, model.id);
    this.completeModelLoad();
  }

  private loadGLB(model: any, index: number, modelUrl: string) {
    this.gltfLoader.load(modelUrl, (gltf) => {
      const group = new THREE.Group();
      const gltfScene = gltf.scene;

      group.add(gltfScene);
      group.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(gltfScene);
      const center = box.getCenter(new THREE.Vector3());
      gltfScene.position.sub(center);

      const explodedRotation = model.explodedRotation || model.rotation || [0, 0, 0];

      group.rotation.x = explodedRotation[0] ?? 0;
      group.rotation.y = explodedRotation[1] ?? 0;
      group.rotation.z = explodedRotation[2] ?? 0;

      this.registerLoadedModel(model, index, group);
    });
  }

  private registerLoadedModel(model: any, index: number, object: THREE.Object3D) {
    const scale = model.scale ?? (this.getModelFileType(model) === 'glb' ? 1 : 0.006);
    object.scale.set(scale, scale, scale);

    const initialPosition =
      this.isEditorMode() && model.targetPosition
        ? model.targetPosition
        : model.explodedPosition || model.initialPosition || this.getFloatingPosition(index);

    object.position.set(
      initialPosition[0],
      initialPosition[1],
      initialPosition[2]
    );

    object.updateMatrixWorld(true);
    object.userData['componentId'] = model.id;
    object.userData['assembled'] = false;
    object.userData['isMoving'] = false;
    object.userData['isDragging'] = false;
    object.userData['locked'] = false;
    object.userData['targetPosition'] = null;
    object.userData['finalPosition'] = model.targetPosition;
    object.userData['originalPosition'] = object.position.clone();
    object.userData['explodedRotation'] = object.rotation.clone();
    object.userData['assembledPosition'] = null;
    object.userData['dragRejectedOnStart'] = false;
    object.userData['rotationSpeed'] = 0.001 + Math.random() * 0.002;

    this.assemblyContainer.add(object);
    this.meshMap[model.id] = object;
    this.interactiveMeshes.push(object);
    this.markPartChildren(object, model.id);
    this.completeModelLoad();
  }

  private markPartChildren(object: THREE.Object3D, componentId: string) {
    object.traverse(child => {
      child.userData['componentId'] = componentId;
      child.userData['partRoot'] = object;
    });
  }

  private completeModelLoad() {
    this.stlLoadedCount++;

    if (this.stlLoadedCount === this.stlTotal) {
      this.stlReady = true;
      this.applyFallbackExplodedLayoutIfCollapsed();
      this.normalizeExplodedLayoutForViewport();
      requestAnimationFrame(() => this.fitCameraToObject(this.assemblyContainer));

      if (this.isDragDropMode()) {
        this.setupDragControls();
      }
    }
  }

  private setupOrbitControls() {
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enablePan = true;
    this.controls.enableZoom = true;
    this.controls.enableRotate = true;
    this.updateOrbitControlsForMode();
  }

  private normalizeExplodedLayoutForViewport() {
    if (!this.isSceneDrivenProject() || !this.assemblyContainer || !this.interactiveMeshes.length) return;

    const box = new THREE.Box3().setFromObject(this.assemblyContainer);

    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const maxWidth = 9;
    const maxHeight = 5.5;
    const scale = Math.min(
      1,
      maxWidth / Math.max(size.x, 0.001),
      maxHeight / Math.max(size.y, 0.001)
    );

    if (scale >= 1) return;

    const center = box.getCenter(new THREE.Vector3());

    this.interactiveMeshes.forEach(mesh => {
      mesh.position.sub(center).multiplyScalar(scale).add(center);
      mesh.userData['originalPosition'] = mesh.position.clone();
    });
  }

  private applyFallbackExplodedLayoutIfCollapsed() {
    if (!this.isSceneDrivenProject() || this.interactiveMeshes.length < 2) return;

    const positionBox = new THREE.Box3();

    this.interactiveMeshes.forEach(mesh => positionBox.expandByPoint(mesh.position));

    if (positionBox.isEmpty()) return;

    const positionSpread = positionBox.getSize(new THREE.Vector3()).length();
    const modelCenter = positionBox.getCenter(new THREE.Vector3());

    if (positionSpread > 1.2) return;

    const radius = 2.2;

    this.interactiveMeshes.forEach((mesh, index) => {
      const angle = (index / this.interactiveMeshes.length) * Math.PI * 2;
      const explodedPosition = new THREE.Vector3(
        modelCenter.x + Math.cos(angle) * radius,
        modelCenter.y + Math.sin(angle) * radius * 0.62,
        modelCenter.z
      );

      mesh.position.copy(explodedPosition);
      mesh.userData['originalPosition'] = explodedPosition.clone();
    });
  }

  private setupTransformControls() {
    if (!this.isEditorMode()) return;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.editorTransformMode);
    this.transformControls.setSize(0.85);
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
      if (this.controls) this.controls.enabled = !event.value;
      Object.values(this.meshMap).forEach(mesh => {
        mesh.userData['isDragging'] = event.value;
      });
    });
    this.scene.add(this.transformControls as unknown as THREE.Object3D);
  }

  loadCubeSimulation() {
    this.createSlot('base', 0, 0);
    this.createSlot('motor', 0, 1.2);
    this.createSlot('cover', 0, 2.4);

    this.createComponent('base', 0xfffff9, -2);
    this.createComponent('motor', 0xfffff9, 0);
    this.createComponent('cover', 0xfffff9, 2);
  }

  createSlot(id: string, x: number, y: number) {
    const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.2,
    });

    const slot = new THREE.Mesh(geometry, material);

    slot.position.set(
      x + this.stackOffset.x,
      y + this.stackOffset.y,
      0
    );

    this.scene.add(slot);
    this.slotMap[id] = slot;
  }

  createComponent(id: string, color: number, x: number) {
    if (this.isStlMode) return;

    const geometry = new THREE.BoxGeometry();
    const texture = this.createTextTexture(id);

    const material = new THREE.MeshStandardMaterial({ map: texture });

    const mesh = new THREE.Mesh(geometry, material);

    mesh.position.set(x, 2, 0);

    mesh.userData['componentId'] = id;
    mesh.userData['assembled'] = false;
    mesh.userData['isMoving'] = false;
    mesh.userData['targetPosition'] = null;
    mesh.userData['originalPosition'] = mesh.position.clone();
    mesh.userData['explodedRotation'] = mesh.rotation.clone();

    this.assemblyContainer.add(mesh);
    this.meshMap[id] = mesh;
    this.interactiveMeshes.push(mesh);
  }

  onCanvasClick(event: MouseEvent) {
    if (this.isInteractionLocked()) return;

    if (this.isEditorMode()) {
      this.selectEditorObject(event);
      return;
    }

    if (this.assemblyRotationEnabled) return;
    if (this.isDragDropMode()) return;
    if (this.isStlMode && !this.stlReady) return;
    const rect = this.canvasRef.nativeElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.interactiveMeshes, true);

    if (hits.length > 0) {
      const hitObject = hits[0].object;
      const root = hitObject.userData['partRoot'] || hitObject;
      const id = Object.keys(this.meshMap).find(k => this.meshMap[k] === root);

      if (id) {
        this.meshClicked.emit(id);
      }
    }
  }

  attachComponent(componentId: string): boolean {
    if (this.isInteractionLocked()) return false;
    if (this.assemblyRotationEnabled) return false;

    const mesh = this.meshMap[componentId];
    if (!mesh) return false;

    if (this.isStlMode) {
      if (this.movingComponentId || mesh.userData['assembled'] || mesh.userData['isMoving']) {
        return false;
      }

      const expectedModel = this.project.models[this.currentStep];

      if (!expectedModel || expectedModel.id !== componentId) {
        this.markError(componentId);
        return false;
      }

      const defaultFinalPosition = this.getDefaultFinalPosition(this.currentStep);
      const finalPosition =
        this.getAssemblyTarget(componentId) || new THREE.Vector3(
          defaultFinalPosition[0],
          defaultFinalPosition[1],
          defaultFinalPosition[2]
        );

      this.movingComponentId = componentId;
      mesh.userData['isMoving'] = true;

      mesh.userData['targetPosition'] = {
        x: 3,
        y: -4,
        z: 0
      };

      mesh.userData['onArrival'] = () => {
        mesh.userData['targetPosition'] = {
          x: finalPosition.x,
          y: finalPosition.y,
          z: finalPosition.z
        };

        mesh.userData['onArrival'] = () => {
          mesh.userData['assembled'] = true;
          mesh.userData['isMoving'] = false;
          this.movingComponentId = null;
          this.applySavedRotation(mesh, componentId);
          this.addMeshToAssemblyGroup(mesh);
          this.currentStep++;
          this.setAssemblyState();
          if (this.currentStep === this.project.models.length) {
            requestAnimationFrame(() => this.fitCameraToObject(this.assemblyContainer));
          }
          this.componentAssembled.emit(componentId);
        };
      };

      return true;
    }

    const slot = this.slotMap[componentId];
    if (!slot || mesh.userData['assembled'] || mesh.userData['isMoving']) return false;

    mesh.userData['isMoving'] = true;
    mesh.userData['targetPosition'] = {
      x: slot.position.x,
      y: slot.position.y,
      z: slot.position.z
    };

    mesh.userData['onArrival'] = () => {
      mesh.userData['assembled'] = true;
      mesh.userData['isMoving'] = false;
      this.addMeshToAssemblyGroup(mesh);
      this.componentAssembled.emit(componentId);
      this.setAssemblyState();
    };

    const material = slot.material as THREE.MeshStandardMaterial;

    material.color.set(0x00ff00);
    material.transparent = true;
    material.opacity = 0.6;
    material.needsUpdate = true;

    return true;
  }

  markError(componentId: string) {
    const mesh = this.meshMap[componentId];
    if (!mesh) return;

    mesh.traverse(child => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;

      if (!material?.color) return;

      const original = material.color.getHex();
      material.color.set(0xff0000);

      setTimeout(() => material.color.set(original), 500);
    });
  }

  createTextTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = '#000';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 128);

    return new THREE.CanvasTexture(canvas);
  }

  private getFloatingPosition(index: number): number[] {
    const spacing = 2.5;
    const total = this.project.models.length;
    const startX = -((total - 1) * spacing) / 2;

    return [startX + index * spacing, 2, 0];
  }

  private getDefaultFinalPosition(index: number): number[] {
    const yPositions = [-2, -1.2, -1.1, -0.1, 0.2];
    return [0, yPositions[index] ?? -2 + index * 0.7, 0];
  }

  private isDragDropMode(): boolean {
    return this.workspaceMode === 'simulation' && this.interactionMode === 'drag-drop' && this.isStlMode;
  }

  private isEditorMode(): boolean {
    return this.workspaceMode === 'editor' && this.isStlMode;
  }

  private isSceneDrivenProject(): boolean {
    return this.project?.sourceType === 'glb-scene';
  }

  private setupDragControls() {
    if (this.isEditorMode()) return;

    this.disposeDragControls();

    this.dragControls = new DragControls(
      Object.values(this.meshMap),
      this.camera,
      this.renderer.domElement
    );

    this.dragControls.addEventListener('dragstart', (event) => {
      const mesh = event.object;
      const componentId = mesh.userData['componentId'];
      const expectedModel = this.project.models[this.currentStep];
      const canDrag =
        !this.isInteractionLocked() &&
        !this.assemblyRotationEnabled &&
        (mesh.userData['assembled'] || expectedModel?.id === componentId);

      mesh.userData['isDragging'] = true;
      mesh.userData['dragRejectedOnStart'] = !canDrag;
      mesh.userData['dragStartPosition'] = mesh.position.clone();
      if (this.controls) this.controls.enabled = false;
      this.highlightTarget(componentId, canDrag);
    });

    this.dragControls.addEventListener('drag', (event) => {
      const mesh = event.object;

      if (mesh.userData['dragRejectedOnStart']) {
        const dragStartPosition = mesh.userData['dragStartPosition'] as THREE.Vector3 | undefined;

        if (dragStartPosition) {
          mesh.position.copy(dragStartPosition);
        }
      }

      mesh.position.z = 0;
    });

    this.dragControls.addEventListener('dragend', (event) => {
      const mesh = event.object;
      mesh.userData['isDragging'] = false;
      mesh.position.z = 0;
      this.clearTargetHighlights();
      if (this.controls) this.controls.enabled = true;
      this.handleDragDrop(mesh);
    });
  }

  private handleDragDrop(mesh: THREE.Object3D) {
    const componentId = mesh.userData['componentId'];

    if (mesh.userData['assembled'] || mesh.userData['locked']) {
      this.handleAssembledPartDrop(mesh);
      return;
    }

    const expectedModel = this.project.models[this.currentStep];
    const target = this.getAssemblyTarget(componentId);
    const isCorrectSequence =
      !mesh.userData['dragRejectedOnStart'] &&
      expectedModel?.id === componentId;
    const isNearTarget =
      !!target && mesh.position.distanceTo(target) < this.snapThreshold;

    if (isCorrectSequence && isNearTarget && target) {
      mesh.position.copy(target);
      this.applySavedRotation(mesh, componentId);
      mesh.userData['assembled'] = true;
      mesh.userData['locked'] = true;
      mesh.userData['isMoving'] = false;
      mesh.userData['targetPosition'] = null;
      mesh.userData['assembledPosition'] = target.clone();
      this.addMeshToAssemblyGroup(mesh);
      this.currentStep++;
      this.setAssemblyState();
      if (this.currentStep === this.project.models.length) {
        requestAnimationFrame(() => this.fitCameraToObject(this.assemblyContainer));
      }
      this.componentAssembled.emit(componentId);
      return;
    }

    this.markError(componentId);
    if (mesh.userData['dragRejectedOnStart']) {
      const dragStartPosition = mesh.userData['dragStartPosition'] as THREE.Vector3 | undefined;

      if (dragStartPosition) {
        mesh.userData['targetPosition'] = {
          x: dragStartPosition.x,
          y: dragStartPosition.y,
          z: dragStartPosition.z
        };
        return;
      }
    }
    this.returnToOriginalPosition(mesh);
  }

  private handleAssembledPartDrop(mesh: THREE.Object3D) {
    const componentId = mesh.userData['componentId'];
    const assembledPosition = mesh.userData['assembledPosition'] as THREE.Vector3 | undefined;

    if (!assembledPosition) {
      this.returnToOriginalPosition(mesh);
      return;
    }

    const stillAssembled = mesh.position.distanceTo(assembledPosition) < this.snapThreshold;

    if (stillAssembled) {
      this.returnToAssembledPosition(mesh);
      return;
    }

    this.disassembleFrom(componentId);
  }

  canUndoLastAssembly(): boolean {
    return this.workspaceMode === 'simulation' &&
      this.currentStep > 0 &&
      !this.movingComponentId &&
      !this.assemblyRotationEnabled &&
      !this.isInteractionLocked();
  }

  undoLastAssembly(): string | null {
    if (!this.canUndoLastAssembly()) return null;

    const model = this.project.models[this.currentStep - 1];
    const mesh = this.meshMap[model.id];

    if (!mesh) return null;

    this.currentStep--;
    this.setAssemblyState();
    mesh.userData['assembled'] = false;
    mesh.userData['locked'] = false;
    mesh.userData['isDragging'] = false;
    mesh.userData['assembledPosition'] = null;
    this.removeMeshFromAssemblyGroup(mesh);
    this.returnToOriginalPosition(mesh);

    return model.id;
  }

  canToggleAutoAssembly(): boolean {
    return this.workspaceMode === 'simulation' &&
      this.stlReady &&
      this.project?.models?.length > 0 &&
      !this.isAutoAssembling &&
      !this.isExploding &&
      !this.movingComponentId;
  }

  async toggleAutoAssembly(): Promise<'assembled' | 'exploded' | null> {
    if (!this.canToggleAutoAssembly()) return null;

    if (this.isFullyAssembled) {
      await this.explodeAssembly();
      return 'exploded';
    }

    await this.assembleAllSequentially();
    return 'assembled';
  }

  private async assembleAllSequentially() {
    this.isAutoAssembling = true;
    this.isExploded = false;
    this.autoAssemblyProgress = `Assembling ${this.currentStep} / ${this.project.models.length}`;
    this.assemblyRotationEnabled = false;
    this.resetAssemblyInspectionRotation();
    this.updateInteractionControls();

    try {
      while (this.currentStep < this.project.models.length) {
        const model = this.project.models[this.currentStep];
        const mesh = this.meshMap[model.id];

        if (!mesh) {
          this.currentStep++;
          this.setAssemblyState();
          continue;
        }

        this.autoAssemblyProgress = `Assembling ${this.currentStep + 1} / ${this.project.models.length}`;
        await this.animateComponentToAssembly(model.id, true);
        await this.wait(140);
      }

      this.setAssemblyState();
      requestAnimationFrame(() => this.fitCameraToObject(this.assemblyContainer));
    } finally {
      this.isAutoAssembling = false;
      this.autoAssemblyProgress = '';
      this.updateInteractionControls();
    }
  }

  private animateComponentToAssembly(componentId: string, emitCompletion: boolean): Promise<void> {
    const mesh = this.meshMap[componentId];

    if (!mesh || mesh.userData['assembled']) return Promise.resolve();

    const stepIndex = this.project.models.findIndex(model => model.id === componentId);
    const defaultFinalPosition = this.getDefaultFinalPosition(Math.max(stepIndex, 0));
    const finalPosition =
      this.getAssemblyTarget(componentId) || new THREE.Vector3(
        defaultFinalPosition[0],
        defaultFinalPosition[1],
        defaultFinalPosition[2]
      );

    this.movingComponentId = componentId;
    mesh.userData['isMoving'] = true;

    return new Promise(resolve => {
      mesh.userData['targetPosition'] = {
        x: 3,
        y: -4,
        z: 0
      };

      mesh.userData['onArrival'] = () => {
        mesh.userData['targetPosition'] = {
          x: finalPosition.x,
          y: finalPosition.y,
          z: finalPosition.z
        };

        mesh.userData['onArrival'] = () => {
          mesh.userData['assembled'] = true;
          mesh.userData['locked'] = true;
          mesh.userData['isMoving'] = false;
          mesh.userData['assembledPosition'] = finalPosition.clone();
          this.movingComponentId = null;
          this.applySavedRotation(mesh, componentId);
          this.addMeshToAssemblyGroup(mesh);
          this.currentStep = Math.max(this.currentStep, stepIndex + 1);
          this.setAssemblyState();

          if (emitCompletion) {
            this.componentAssembled.emit(componentId);
          }

          resolve();
        };
      };
    });
  }

  private async explodeAssembly() {
    this.isExploding = true;
    this.autoAssemblyProgress = 'Exploding';
    this.assemblyRotationEnabled = false;
    this.resetAssemblyInspectionRotation();
    this.updateInteractionControls();

    try {
      const sequence = [...this.project.models].reverse();

      await Promise.all(sequence.map((model, index) => new Promise<void>(resolve => {
        window.setTimeout(() => {
          const mesh = this.meshMap[model.id];

          if (!mesh) {
            resolve();
            return;
          }

          mesh.userData['assembled'] = false;
          mesh.userData['locked'] = false;
          mesh.userData['isDragging'] = false;
          mesh.userData['assembledPosition'] = null;
          this.returnToOriginalPosition(mesh, resolve);
        }, index * 45);
      })));

      this.currentStep = 0;
      this.setAssemblyState();
      this.assemblyExploded.emit();
      requestAnimationFrame(() => this.fitCameraToObject(this.assemblyContainer));
    } finally {
      this.isExploding = false;
      this.autoAssemblyProgress = '';
      this.updateInteractionControls();
    }
  }

  private disassembleFrom(componentId: string) {
    const stepIndex = this.project.models.findIndex(model => model.id === componentId);

    if (stepIndex === -1 || stepIndex >= this.currentStep) return;

    for (let i = stepIndex; i < this.currentStep; i++) {
      const model = this.project.models[i];
      const mesh = this.meshMap[model.id];

      if (!mesh) continue;

      mesh.userData['assembled'] = false;
      mesh.userData['locked'] = false;
      mesh.userData['isDragging'] = false;
      mesh.userData['assembledPosition'] = null;
      this.removeMeshFromAssemblyGroup(mesh);
      this.returnToOriginalPosition(mesh);
    }

    this.currentStep = stepIndex;
    this.setAssemblyState();
    this.componentDisassembled.emit(componentId);
  }

  private returnToOriginalPosition(mesh: THREE.Object3D, onComplete?: () => void) {
    const original = mesh.userData['originalPosition'] as THREE.Vector3 | undefined;
    if (!original) {
      onComplete?.();
      return;
    }

    this.removeMeshFromAssemblyGroup(mesh);
    this.applyExplodedRotation(mesh);
    mesh.userData['isMoving'] = true;
    mesh.userData['targetPosition'] = {
      x: original.x,
      y: original.y,
      z: original.z
    };
    mesh.userData['onArrival'] = () => {
      mesh.userData['isMoving'] = false;
      this.applyExplodedRotation(mesh);
      onComplete?.();
    };
  }

  private returnToAssembledPosition(mesh: THREE.Object3D) {
    const assembledPosition = mesh.userData['assembledPosition'] as THREE.Vector3 | undefined;
    if (!assembledPosition) return;

    mesh.userData['isMoving'] = true;
    mesh.userData['targetPosition'] = {
      x: assembledPosition.x,
      y: assembledPosition.y,
      z: assembledPosition.z
    };
    mesh.userData['onArrival'] = () => {
      mesh.userData['isMoving'] = false;
      mesh.rotation.set(0, 0, 0);
    };
  }

  private getAssemblyTarget(componentId: string): THREE.Vector3 | null {
    const model = this.project.models.find(part => part.id === componentId);

    const savedTarget = model?.originalPosition || model?.targetPosition;

    if (savedTarget?.length === 3) {
      return new THREE.Vector3(
        savedTarget[0],
        savedTarget[1],
        savedTarget[2]
      );
    }

    const configuredTarget = this.assemblyTargets[componentId];
    if (configuredTarget) return configuredTarget;

    const index = this.project.models.findIndex(part => part.id === componentId);
    if (index === -1) return null;

    return new THREE.Vector3(3, -3 + index * 0.7, 0);
  }

  private applySavedRotation(object: THREE.Object3D, componentId: string) {
    const model = this.project.models.find(part => part.id === componentId);
    const rotation = model?.originalRotation || model?.rotation;

    if (!rotation?.length) {
      object.rotation.set(0, 0, 0);
      return;
    }

    object.rotation.set(
      rotation[0] || 0,
      rotation[1] || 0,
      rotation[2] || 0
    );
  }

  private applyExplodedRotation(object: THREE.Object3D) {
    const explodedRotation = object.userData['explodedRotation'] as THREE.Euler | undefined;

    if (!explodedRotation) return;

    object.rotation.copy(explodedRotation);
  }

  private createAssemblyTargetGhosts() {
    this.clearAssemblyTargetGhosts();

    if (!this.isDragDropMode()) return;

    this.project.models.forEach(model => {
      const target = this.getAssemblyTarget(model.id);
      if (!target) return;

      const geometry = new THREE.BoxGeometry(1.2, 0.2, 1.2);
      const material = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.22,
        emissive: 0x0f5132,
        emissiveIntensity: 0.35,
      });
      const ghost = new THREE.Mesh(geometry, material);

      ghost.position.copy(target);
      ghost.userData['targetFor'] = model.id;
      this.scene.add(ghost);
      this.targetGhosts.push(ghost);
    });
  }

  private highlightTarget(componentId: string, valid: boolean) {
    this.targetGhosts.forEach(ghost => {
      if (ghost.userData['targetFor'] !== componentId) return;

      const material = ghost.material as THREE.MeshStandardMaterial;
      material.color.set(valid ? 0x22c55e : 0xef4444);
      material.opacity = valid ? 0.45 : 0.32;
      material.needsUpdate = true;
    });
  }

  private clearTargetHighlights() {
    this.targetGhosts.forEach(ghost => {
      const material = ghost.material as THREE.MeshStandardMaterial;
      material.color.set(0x22c55e);
      material.opacity = 0.22;
      material.needsUpdate = true;
    });
  }

  private clearAssemblyTargetGhosts() {
    this.targetGhosts.forEach(ghost => {
      this.scene?.remove(ghost);
      ghost.geometry.dispose();
      (ghost.material as THREE.Material).dispose();
    });

    this.targetGhosts = [];
  }

  private disposeDragControls() {
    if (!this.dragControls) return;

    this.dragControls.dispose();
    this.dragControls = undefined as unknown as DragControls;
  }

  private disposeTransformControls() {
    if (!this.transformControls) return;

    this.transformControls.detach();
    this.transformControls.dispose();
    this.transformControls = undefined as unknown as TransformControls;
  }

  private fitCameraToObject(object: THREE.Object3D) {
    if (!object || !this.camera || !this.controls) return;

    const box = new THREE.Box3().setFromObject(object);

    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const fitHeightDistance = size.y / (2 * Math.tan(verticalFov / 2));
    const fitWidthDistance = size.x / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(fitHeightDistance, fitWidthDistance, maxDimension * 1.1, 4) * 1.2;

    this.camera.position.set(center.x, center.y, center.z + distance);
    this.camera.near = Math.max(distance / 100, 0.01);
    this.camera.far = Math.max(distance * 100, 1000);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  private selectEditorObject(event: MouseEvent) {
    if (!this.transformControls || !this.stlReady) return;

    const rect = this.canvasRef.nativeElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(this.interactiveMeshes, true);

    if (!hits.length) {
      this.clearSelection();
      return;
    }

    const hitObject = hits[0].object;
    const root = hitObject.userData['partRoot'] || hitObject;

    this.setSelectedObject(root);
  }

  private setSelectedObject(object: THREE.Object3D) {
    this.clearSelection();
    this.selectedObject = object;
    this.transformControls.attach(object);
    this.highlightSelectedObject(object);
  }

  private clearSelection() {
    if (this.selectedObject) {
      this.restoreSelectedHighlight(this.selectedObject);
    }

    this.selectedObject = null;
    this.selectedOriginalEmissive.clear();
    this.transformControls?.detach();
  }

  private highlightSelectedObject(object: THREE.Object3D) {
    object.traverse(child => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;

      if (!material?.emissive) return;

      this.selectedOriginalEmissive.set(material, material.emissive.getHex());
      material.emissive.set(0x164e63);
      material.emissiveIntensity = 0.45;
    });
  }

  private restoreSelectedHighlight(object: THREE.Object3D) {
    object.traverse(child => {
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      const original = material ? this.selectedOriginalEmissive.get(material) : undefined;

      if (!material?.emissive || original === undefined) return;

      material.emissive.set(original);
      material.emissiveIntensity = 0;
    });
  }

  canRotateAssembly(): boolean {
    return this.isFullyAssembled &&
      !this.isInteractionLocked() &&
      !!this.assembledGroup &&
      this.assembledGroup.children.length > 0;
  }

  private onAssemblyRotatePointerDown(event: PointerEvent) {
    if (!this.assemblyRotationEnabled || !this.canRotateAssembly()) return;

    this.isRotatingAssembly = true;
    this.lastRotationPointer = {
      x: event.clientX,
      y: event.clientY
    };
    this.updateDragControlsEnabled();
    if (this.controls) this.controls.enabled = false;
    this.canvasRef.nativeElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  private onAssemblyRotatePointerMove(event: PointerEvent) {
    if (!this.isRotatingAssembly || !this.assembledGroup) return;

    const deltaX = event.clientX - this.lastRotationPointer.x;
    const deltaY = event.clientY - this.lastRotationPointer.y;

    this.assembledGroup.rotation.y += deltaX * 0.01;
    this.assembledGroup.rotation.x += deltaY * 0.01;
    this.assembledGroup.rotation.x = THREE.MathUtils.clamp(
      this.assembledGroup.rotation.x,
      -Math.PI / 2,
      Math.PI / 2
    );

    this.lastRotationPointer = {
      x: event.clientX,
      y: event.clientY
    };
  }

  private onAssemblyRotatePointerUp() {
    if (!this.isRotatingAssembly) return;

    this.isRotatingAssembly = false;
    this.updateDragControlsEnabled();
    if (this.controls) this.controls.enabled = true;
    this.updateOrbitControlsForMode();
  }

  private addMeshToAssemblyGroup(mesh: THREE.Object3D) {
    if (!this.assembledGroup || mesh.parent === this.assembledGroup) return;

    this.assembledGroup.attach(mesh);
  }

  private removeMeshFromAssemblyGroup(mesh: THREE.Object3D) {
    if (!this.assemblyContainer || mesh.parent === this.assemblyContainer) return;

    this.assemblyContainer.attach(mesh);
  }

  private updateDragControlsEnabled() {
    if (!this.dragControls) return;

    this.dragControls.enabled = !this.assemblyRotationEnabled && !this.isInteractionLocked();
  }

  private updateOrbitControlsForMode() {
    if (!this.controls) return;

    const enabled = !this.assemblyRotationEnabled && !this.isInteractionLocked();

    this.controls.enabled = enabled;
    this.controls.enableRotate = enabled;
    this.controls.enablePan = enabled;
    this.controls.enableZoom = enabled;
  }

  private resetAssemblyInspectionRotation() {
    if (!this.assembledGroup) return;

    this.isRotatingAssembly = false;
    this.assembledGroup.rotation.set(0, 0, 0);
    this.assembledGroup.updateMatrixWorld(true);
  }

  private updateInteractionControls() {
    this.updateDragControlsEnabled();
    this.updateOrbitControlsForMode();
    this.clearSelection();
  }

  private isInteractionLocked(): boolean {
    return this.isAutoAssembling || this.isExploding;
  }

  private setAssemblyState() {
    const totalParts = this.project?.models?.length || 0;

    this.isFullyAssembled = totalParts > 0 && this.currentStep >= totalParts;
    this.isExploded = this.currentStep === 0 && !this.isFullyAssembled;
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  getEditedModels() {
    return this.project.models.map((model, index) => {
      const object = this.meshMap[model.id];

      if (!object) {
        return {
          ...model,
          order: index
        };
      }

      return {
        ...model,
        originalPosition: [
          this.roundTransformValue(object.position.x),
          this.roundTransformValue(object.position.y),
          this.roundTransformValue(object.position.z)
        ],
        explodedPosition: [
          this.roundTransformValue(object.position.x),
          this.roundTransformValue(object.position.y),
          this.roundTransformValue(object.position.z)
        ],
        targetPosition: [
          this.roundTransformValue(object.position.x),
          this.roundTransformValue(object.position.y),
          this.roundTransformValue(object.position.z)
        ],
        originalRotation: [
          this.roundTransformValue(object.rotation.x),
          this.roundTransformValue(object.rotation.y),
          this.roundTransformValue(object.rotation.z)
        ],
        rotation: [
          this.roundTransformValue(object.rotation.x),
          this.roundTransformValue(object.rotation.y),
          this.roundTransformValue(object.rotation.z)
        ],
        explodedRotation: [
          this.roundTransformValue(object.rotation.x),
          this.roundTransformValue(object.rotation.y),
          this.roundTransformValue(object.rotation.z)
        ],
        originalScale: [
          this.roundTransformValue(object.scale.x),
          this.roundTransformValue(object.scale.y),
          this.roundTransformValue(object.scale.z)
        ],
        scale: this.roundTransformValue(object.scale.x),
        assembled: false,
        order: index
      };
    });
  }

  applyExplodedView() {
    if (!this.project?.models?.length) return;

    const spacing = 2.4;
    const startX = -((this.project.models.length - 1) * spacing) / 2;

    this.project.models.forEach((model, index) => {
      const object = this.meshMap[model.id];

      if (!object) return;

      object.position.set(startX + index * spacing, 2, 0);
      object.userData['originalPosition'] = object.position.clone();
      object.userData['explodedRotation'] = object.rotation.clone();
    });
  }

  private getHierarchyPath(object: THREE.Object3D): string {
    const segments: string[] = [];
    let current: THREE.Object3D | null = object;

    while (current) {
      const siblingIndex = current.parent?.children.indexOf(current) ?? 0;
      segments.unshift(`${current.name || current.type || 'Object'}[${siblingIndex}]`);
      current = current.parent;
    }

    return segments.join('/');
  }

  private roundTransformValue(value: number): number {
    return Number(value.toFixed(4));
  }

  private resetScene() {
    this.disposeDragControls();
    this.disposeTransformControls();
    this.controls?.dispose();
    this.clearSelection();
    this.clearAssemblyTargetGhosts();
    this.meshMap = {};
    this.slotMap = {};
    this.interactiveMeshes = [];

    while (this.scene.children.length) {
      const child = this.scene.children[0];
      this.scene.remove(child);
    }

    this.initScene();
  }

  private getModelFileUrl(file: string): string {
    if (!file) return file;

    const legacyAssetPath = /^\/?assets\/models\//;
    const normalizedFile = file.replace(legacyAssetPath, 'models/');

    if (/^(https?:|data:|blob:|\/)/.test(normalizedFile)) {
      return normalizedFile;
    }

    return `/${normalizedFile}`;
  }

  private getModelFileType(model: any): 'stl' | 'glb' {
    if (model.fileType === 'glb' || model.fileType === 'stl') {
      return model.fileType;
    }

    const fileName = String(model.fileName || model.file || '').toLowerCase();

    if (fileName.includes('.glb') || fileName.includes('model/gltf-binary')) {
      return 'glb';
    }

    return 'stl';
  }
}
