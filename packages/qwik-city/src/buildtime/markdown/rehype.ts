import type { Transformer } from 'unified';
import Slugger from 'github-slugger';
import type { Root } from 'mdast';
import type { MdxjsEsm } from 'mdast-util-mdx';
import { valueToEstree } from 'estree-util-value-to-estree';
import { headingRank } from 'hast-util-heading-rank';
import { toString } from 'hast-util-to-string';
import { visit } from 'unist-util-visit';
import type { PageBreadcrumb, PageHeading } from '../../runtime';
import { dirname, resolve } from 'path';
import type { BuildContext, PageRoute } from '../types';
import { getPagePathname } from '../utils/pathname';
import { existsSync } from 'fs';

const slugs = new Slugger();

export function rehypePage(ctx: BuildContext): Transformer {
  return (ast, vfile) => {
    const mdast = ast as Root;
    const sourcePath = vfile.path;
    const pathname = getPagePathname(ctx.opts, vfile.path);
    const menuPathname = getMenuPathname(ctx, pathname);

    updateContentLinks(mdast, sourcePath);
    exportContentHeadings(mdast);
    exportPageAttributes(ctx, mdast, pathname);
    exportBreadcrumbs(ctx, mdast, pathname, menuPathname);
    exportPageIndex(ctx, mdast, menuPathname);
  };
}

function updateContentLinks(mdast: Root, sourcePath: string) {
  visit(mdast, 'element', (node: any) => {
    const tagName = node && node.type === 'element' && node.tagName.toLowerCase();
    if (tagName !== 'a') {
      return;
    }

    const href = ((node.properties && node.properties.href) || '').trim();
    if (!isLocalHref(href)) {
      return;
    }

    const lowerHref = href.toLowerCase();
    if (lowerHref.endsWith('.mdx') || lowerHref.endsWith('.md')) {
      const mdxPath = resolve(dirname(sourcePath), href);
      const mdxExists = existsSync(mdxPath);
      if (!mdxExists) {
        console.warn(
          `\nThe link "${href}", found within "${sourcePath}", does not have a matching source file.\n`
        );
        return;
      }

      if (lowerHref.endsWith('.mdx')) {
        node.properties.href = node.properties.href.substring(0, href.length - 4);
      } else if (lowerHref.endsWith('.md')) {
        node.properties.href = node.properties.href.substring(0, href.length - 3);
      }
    }
  });
}

function exportContentHeadings(mdast: Root) {
  slugs.reset();
  const headings: PageHeading[] = [];

  visit(mdast, 'element', (node: any) => {
    const level = headingRank(node);
    if (level && node.properties && !hasProperty(node, 'id')) {
      const text = toString(node);
      const id = slugs.slug(text);
      node.properties.id = id;

      headings.push({
        text,
        id,
        level,
      });
    }
  });

  createExport(mdast, 'headings', headings);
}

function exportPageAttributes(ctx: BuildContext, mdast: Root, pathname: string) {
  const page = ctx.routes.find((p) => p.pathname === pathname) as PageRoute;
  const attributes = page?.attributes || {};
  createExport(mdast, 'attributes', attributes);
}

function exportBreadcrumbs(
  ctx: BuildContext,
  mdast: Root,
  pathname: string,
  menuPathname: string | undefined
) {
  const menu = ctx.menus.find((m) => m.pathname === menuPathname);
  if (menu && menu.items) {
    for (const indexA of menu.items) {
      const breadcrumbA: PageBreadcrumb = {
        text: indexA.text,
        href: indexA.href,
      };
      if (indexA.href === pathname) {
        createExport(mdast, 'breadcrumbs', [breadcrumbA]);
        return;
      }
      if (indexA.items) {
        for (const indexB of indexA.items) {
          const breadcrumbB: PageBreadcrumb = {
            text: indexB.text,
            href: indexB.href,
          };
          if (indexB.href === pathname) {
            createExport(mdast, 'breadcrumbs', [breadcrumbA, breadcrumbB]);
            return;
          }
          if (indexB.items) {
            for (const indexC of indexB.items) {
              const breadcrumbC: PageBreadcrumb = {
                text: indexC.text,
                href: indexC.href,
              };
              if (indexC.href === pathname) {
                createExport(mdast, 'breadcrumbs', [breadcrumbA, breadcrumbB, breadcrumbC]);
                return;
              }
            }
          }
        }
      }
    }
  }

  createExport(mdast, 'breadcrumbs', []);
}

function exportPageIndex(ctx: BuildContext, mdast: Root, indexPathname: string | undefined) {
  createExport(mdast, 'index', {
    path: indexPathname,
  });
}

function getMenuPathname(ctx: BuildContext, pathname: string) {
  for (let i = 0; i < 9; i++) {
    const index = ctx.menus.find((i) => i.pathname === pathname);
    if (index) {
      return pathname;
    }

    const parts = pathname.split('/');
    parts.pop();

    pathname = parts.join('/');
    if (pathname === '/') {
      break;
    }
  }

  return undefined;
}

function createExport(mdast: Root, identifierName: string, val: any) {
  const mdxjsEsm: MdxjsEsm = {
    type: 'mdxjsEsm',
    value: '',
    data: {
      estree: {
        type: 'Program',
        sourceType: 'module',
        body: [
          {
            type: 'ExportNamedDeclaration',
            source: null,
            specifiers: [],
            declaration: {
              type: 'VariableDeclaration',
              kind: 'const',
              declarations: [
                {
                  type: 'VariableDeclarator',
                  id: { type: 'Identifier', name: identifierName },
                  init: valueToEstree(val),
                },
              ],
            },
          },
        ],
      },
    },
  };
  mdast.children.unshift(mdxjsEsm);
}

function isLocalHref(href: string) {
  href = href.toLowerCase();
  return !(
    href === '' ||
    href.startsWith('#') ||
    href.startsWith('https://') ||
    href.startsWith('http://') ||
    href.startsWith('about:')
  );
}

const own = {}.hasOwnProperty;
function hasProperty(node: any, propName: string) {
  const value =
    propName &&
    node &&
    typeof node === 'object' &&
    node.type === 'element' &&
    node.properties &&
    own.call(node.properties, propName) &&
    node.properties[propName];
  return value != null && value !== false;
}
