import * as React from 'react';
import type { SizeType } from '../config-provider/SizeContext';
export type ElementSemanticName = keyof ElementSemanticClassNames & keyof ElementSemanticStyles;
export type ElementSemanticClassNames = {
    root?: string;
    content?: string;
};
export type ElementSemanticStyles = {
    root?: React.CSSProperties;
    content?: React.CSSProperties;
};
export interface SkeletonElementProps {
    prefixCls?: string;
    className?: string;
    rootClassName?: string;
    style?: React.CSSProperties;
    /**
     * Note: `default` is deprecated and will be removed in v7, please use `medium` instead.
     */
    size?: SizeType | number | 'default';
    shape?: 'circle' | 'square' | 'round' | 'default';
    active?: boolean;
    classNames?: ElementSemanticClassNames;
    styles?: ElementSemanticStyles;
}
declare const Element: React.FC<SkeletonElementProps>;
export default Element;
