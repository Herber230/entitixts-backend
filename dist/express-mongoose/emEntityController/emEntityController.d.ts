import { EMSession } from '../emSession/emSession';
import { EMEntity, EntityDocument } from '../emEntity/emEntity';
import { EMResponseWrapper } from '../emWrapper/emWrapper';
import express = require('express');
declare class EMEntityController<TDocument extends EntityDocument, TEntity extends EMEntity> {
    private _entityName;
    private _session;
    private _responseWrapper;
    private _useEntities;
    private _resourceName;
    protected _router: express.Router;
    constructor(entityName: string, session: EMSession);
    constructor(entityName: string, session: EMSession, resourceName: string);
    retrieve(request: express.Request, response: express.Response): void;
    retrieveById(request: express.Request, response: express.Response): void;
    retriveMetadata(request: express.Request, response: express.Response, next: express.NextFunction): void;
    create(request: express.Request, response: express.Response): void;
    update(request: express.Request, response: express.Response): void;
    delete(request: express.Request, response: express.Response): void;
    private save;
    protected validateDocumentRequest(request: express.Request, response: express.Response): Promise<RequestValidation<TDocument> | void>;
    private constructRouter;
    protected defineRoutes(): void;
    private getQueryParams;
    private readonly entityInfo;
    readonly entityName: string;
    readonly session: EMSession;
    useEntities: boolean;
    readonly router: express.Router;
    protected readonly responseWrapper: EMResponseWrapper<TDocument, TEntity>;
    readonly resourceName: string;
}
interface RequestValidation<TDocument> {
    document?: TDocument;
    error?: string;
    errorData?: any;
    devData?: any;
}
export { EMEntityController };
