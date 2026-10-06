import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Opens a route to anonymous visitors (every route is protected by default). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
