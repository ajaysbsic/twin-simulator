export interface ProjectModel {

  id: string;

  name: string;

  description?: string;

  thumbnail?: string;

  models: ProjectFileModel[];
}

export interface ProjectFileModel {
  id: string;
  name?: string;
  file: string;
  fileName?: string;
  fileType?: 'stl' | 'glb';

  initialPosition?: number[];
  targetPosition?: number[];

  rotation?: number[];

  scale?: number;
  assembled?: boolean;
  order?: number;
}
