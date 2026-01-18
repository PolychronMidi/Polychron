import { describe, it, expect } from 'vitest';
import type { TimingTree, TimingNode } from '../src/TimingTree';

describe('TimingTree', () => {
  it('should define valid timing tree structure', () => {
    const tree: Partial<TimingTree> = {
      root: {
        id: 'root',
        children: [],
      },
    };

    expect(tree.root).toBeDefined();
    expect(tree.root?.id).toBe('root');
  });

  it('should support nested timing nodes', () => {
    const node: TimingNode = {
      id: 'measure-1',
      children: [
        { id: 'beat-1', children: [] },
        { id: 'beat-2', children: [] },
      ],
    };

    expect(node.children.length).toBe(2);
    expect(node.children[0].id).toBe('beat-1');
  });

  it('should allow empty children array', () => {
    const node: TimingNode = {
      id: 'leaf',
      children: [],
    };

    expect(node.children).toEqual([]);
  });

  it('should support deep nesting', () => {
    const tree: Partial<TimingTree> = {
      root: {
        id: 'composition',
        children: [
          {
            id: 'section-1',
            children: [
              {
                id: 'measure-1',
                children: [
                  { id: 'beat-1', children: [] },
                ],
              },
            ],
          },
        ],
      },
    };

    expect(tree.root?.children[0].children[0].children.length).toBe(1);
  });
});
