export interface ProjectModel {

  id: string;

  name: string;

  description?: string;

  thumbnail?: string;

  sourceFile?: string;

  sourceFileName?: string;

  sourceType?: 'glb-scene' | 'multi-file';

  importMetadata?: ProjectImportMetadata;

  models: ProjectFileModel[];
}

export interface ProjectFileModel {
  id: string;
  name?: string;
  file: string;
  fileName?: string;
  fileType?: 'stl' | 'glb';
  sourceFile?: string;
  meshName?: string;
  hierarchyPath?: string;
  parent?: string;

  initialPosition?: number[];
  targetPosition?: number[];
  originalPosition?: number[];
  explodedPosition?: number[];

  rotation?: number[];
  explodedRotation?: number[];
  originalRotation?: number[];
  originalScale?: number[];

  scale?: number;
  assembled?: boolean;
  order?: number;
  assemblyStep?: number;
  distanceFromCenter?: number;
  boundingBox?: {
    min: number[];
    max: number[];
  };
  centerPoint?: number[];
  materialInfo?: {
    name: string;
    type: string;
    color?: string;
  };
}

export interface ProjectImportMetadata {
  sourceFile: string;
  partCount: number;
  hierarchy: ProjectHierarchyNode[];
  generatedAt: string;
  explodeDistance: number;
}

export interface ProjectHierarchyNode {
  name: string;
  type: string;
  path: string;
  children: ProjectHierarchyNode[];
}
