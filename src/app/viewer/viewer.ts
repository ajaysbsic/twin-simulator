import {
  Component, ElementRef, EventEmitter, ViewChild,
  AfterViewInit, Inject, PLATFORM_ID, Output, Input,
  OnDestroy, SimpleChanges
} from '@angular/core';

import { isPlatformBrowser } from '@angular/common';
import * as THREE from 'three';
import { ProjectModel } from '../models/project.model';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { DragControls } from 'three/examples/jsm/controls/DragControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

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
  @ViewChild('canvas') canvasRef!: ElementRef;

  isStlMode = false;
  private isBrowser: boolean;

  scene!: THREE.Scene;
  camera!: THREE.PerspectiveCamera;
  renderer!: THREE.WebGLRenderer;
  dragControls!: DragControls;
  transformControls!: TransformControls;
  assemblyGroup!: THREE.Group;

  meshMap: { [key: string]: THREE.Object3D } = {};
  slotMap: { [key: string]: THREE.Mesh } = {};

  stackOffset = { x: 3, y: -1.5 };

  private stlLoadedCount = 0;
  private stlTotal = 0;
  private stlReady = false;
  private currentStep = 0;
  private movingComponentId: string | null = null;
  private viewReady = false;
  private isRotatingAssembly = false;
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

  constructor(@Inject(PLATFORM_ID) platformId: Object) {
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
      this.updateDragControlsEnabled();
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
    this.renderer?.dispose();
  }

  initScene() {
    const width = this.canvasRef.nativeElement.clientWidth || window.innerWidth;
    const height = this.canvasRef.nativeElement.clientHeight || window.innerHeight;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#050816');
    this.assemblyGroup = new THREE.Group();
    this.scene.add(this.assemblyGroup);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    this.camera.position.z = 6;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvasRef.nativeElement,
      antialias: true,
    });

    this.renderer.setSize(width, height);
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
      if (!this.isEditorMode() && !mesh.userData['assembled'] && !mesh.userData['isMoving'] && !mesh.userData['isDragging']) {
        mesh.rotation.y += mesh.userData['rotationSpeed'] || 0.002;
      }

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
          mesh.rotation.set(0, 0, 0);

          const onArrival = mesh.userData['onArrival'];
          mesh.userData['onArrival'] = null;

          if (typeof onArrival === 'function') {
            onArrival();
          }
        }
      }
    });

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

      mesh.rotation.x = model.rotation?.[0] ?? -Math.PI / 2;
      mesh.rotation.y = model.rotation?.[1] ?? 0;
      mesh.rotation.z = model.rotation?.[2] ?? 0;
      this.registerLoadedModel(model, index, mesh);
    });
  }

  loadProjectModels() {
    this.stlTotal = this.project.models.length;
    this.stlLoadedCount = 0;
    this.stlReady = false;
    this.currentStep = 0;
    this.movingComponentId = null;
    this.createAssemblyTargetGhosts();
    this.project?.models?.forEach((m, i) => this.loadSTL(m, i));
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

      group.rotation.x = model.rotation?.[0] ?? 0;
      group.rotation.y = model.rotation?.[1] ?? 0;
      group.rotation.z = model.rotation?.[2] ?? 0;

      this.registerLoadedModel(model, index, group);
    });
  }

  private registerLoadedModel(model: any, index: number, object: THREE.Object3D) {
    const scale = model.scale ?? (this.getModelFileType(model) === 'glb' ? 1 : 0.006);
    object.scale.set(scale, scale, scale);

    const initialPosition =
      this.isEditorMode() && model.targetPosition
        ? model.targetPosition
        : model.initialPosition || this.getFloatingPosition(index);

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
    object.userData['assembledPosition'] = null;
    object.userData['dragRejectedOnStart'] = false;
    object.userData['rotationSpeed'] = 0.001 + Math.random() * 0.002;

    this.scene.add(object);
    this.meshMap[model.id] = object;
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

      if (this.isDragDropMode()) {
        this.setupDragControls();
      }
    }
  }

  private setupTransformControls() {
    if (!this.isEditorMode()) return;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.editorTransformMode);
    this.transformControls.setSize(0.85);
    this.transformControls.addEventListener('dragging-changed', (event: any) => {
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

    this.scene.add(mesh);
    this.meshMap[id] = mesh;
  }

  onCanvasClick(event: MouseEvent) {
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

    const hits = this.raycaster.intersectObjects(Object.values(this.meshMap), true);

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
    if (this.isDragDropMode()) return false;

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
        mesh.userData['assembled'] ||
        expectedModel?.id === componentId;

      mesh.userData['isDragging'] = true;
      mesh.userData['dragRejectedOnStart'] = !canDrag;
      this.highlightTarget(componentId, canDrag);
    });

    this.dragControls.addEventListener('drag', (event) => {
      const mesh = event.object;
      mesh.position.z = 0;
    });

    this.dragControls.addEventListener('dragend', (event) => {
      const mesh = event.object;
      mesh.userData['isDragging'] = false;
      mesh.position.z = 0;
      this.clearTargetHighlights();
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
      this.componentAssembled.emit(componentId);
      return;
    }

    this.markError(componentId);
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
    return this.isDragDropMode() && this.currentStep > 0 && !this.movingComponentId;
  }

  undoLastAssembly(): string | null {
    if (!this.canUndoLastAssembly()) return null;

    const model = this.project.models[this.currentStep - 1];
    const mesh = this.meshMap[model.id];

    if (!mesh) return null;

    this.currentStep--;
    mesh.userData['assembled'] = false;
    mesh.userData['locked'] = false;
    mesh.userData['isDragging'] = false;
    mesh.userData['assembledPosition'] = null;
    this.removeMeshFromAssemblyGroup(mesh);
    this.returnToOriginalPosition(mesh);

    return model.id;
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
    this.componentDisassembled.emit(componentId);
  }

  private returnToOriginalPosition(mesh: THREE.Object3D) {
    const original = mesh.userData['originalPosition'] as THREE.Vector3 | undefined;
    if (!original) return;

    mesh.userData['isMoving'] = true;
    mesh.userData['targetPosition'] = {
      x: original.x,
      y: original.y,
      z: original.z
    };
    mesh.userData['onArrival'] = () => {
      mesh.userData['isMoving'] = false;
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

    if (model?.targetPosition?.length === 3) {
      return new THREE.Vector3(
        model.targetPosition[0],
        model.targetPosition[1],
        model.targetPosition[2]
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

    if (!model?.rotation?.length) {
      object.rotation.set(0, 0, 0);
      return;
    }

    object.rotation.set(
      model.rotation[0] || 0,
      model.rotation[1] || 0,
      model.rotation[2] || 0
    );
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

  private selectEditorObject(event: MouseEvent) {
    if (!this.transformControls || !this.stlReady) return;

    const rect = this.canvasRef.nativeElement.getBoundingClientRect();

    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const hits = this.raycaster.intersectObjects(Object.values(this.meshMap), true);

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
    if (!this.project?.models?.length) return false;

    return this.project.models.every(model => this.meshMap[model.id]?.userData['assembled']);
  }

  private onAssemblyRotatePointerDown(event: PointerEvent) {
    if (!this.assemblyRotationEnabled || !this.canRotateAssembly()) return;

    this.isRotatingAssembly = true;
    this.lastRotationPointer = {
      x: event.clientX,
      y: event.clientY
    };
    this.updateDragControlsEnabled();
    this.canvasRef.nativeElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  private onAssemblyRotatePointerMove(event: PointerEvent) {
    if (!this.isRotatingAssembly || !this.assemblyGroup) return;

    const deltaX = event.clientX - this.lastRotationPointer.x;
    const deltaY = event.clientY - this.lastRotationPointer.y;

    this.assemblyGroup.rotation.y += deltaX * 0.01;
    this.assemblyGroup.rotation.x += deltaY * 0.01;
    this.assemblyGroup.rotation.x = THREE.MathUtils.clamp(
      this.assemblyGroup.rotation.x,
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
  }

  private addMeshToAssemblyGroup(mesh: THREE.Object3D) {
    if (!this.assemblyGroup || mesh.parent === this.assemblyGroup) return;

    this.assemblyGroup.attach(mesh);
  }

  private removeMeshFromAssemblyGroup(mesh: THREE.Object3D) {
    if (!this.scene || mesh.parent !== this.assemblyGroup) return;

    this.scene.attach(mesh);
  }

  private updateDragControlsEnabled() {
    if (!this.dragControls) return;

    this.dragControls.enabled = !this.assemblyRotationEnabled;
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
        targetPosition: [
          this.roundTransformValue(object.position.x),
          this.roundTransformValue(object.position.y),
          this.roundTransformValue(object.position.z)
        ],
        rotation: [
          this.roundTransformValue(object.rotation.x),
          this.roundTransformValue(object.rotation.y),
          this.roundTransformValue(object.rotation.z)
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
    });
  }

  private roundTransformValue(value: number): number {
    return Number(value.toFixed(4));
  }

  private resetScene() {
    this.disposeDragControls();
    this.disposeTransformControls();
    this.clearSelection();
    this.clearAssemblyTargetGhosts();
    this.meshMap = {};
    this.slotMap = {};

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
