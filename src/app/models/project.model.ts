export interface ProjectModel {

  id: string;

  name: string;

  description?: string;

  models: ProjectFileModel[];
}

export interface ProjectFileModel {
  id: string;
  file: string;

  initialPosition?: number[];
  targetPosition?: number[];

  rotation?: number[];

  scale?: number;
}